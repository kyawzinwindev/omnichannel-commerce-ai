import { Inject, Injectable, Logger, MessageEvent } from '@nestjs/common';
import { IntentService, IntentType, IntentResult } from './intent.service';
import { LlmService } from './llm.service';
import {
  IStoreProvider,
  OrderTimelineResult,
  ProductItem,
  STORE_PROVIDER,
} from '../store/interfaces/store-provider.interface';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RedisChatMessageHistory } from '../redis/redis-chat-history';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { RunnableWithMessageHistory } from '@langchain/core/runnables';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  conversationId: string;
  intent: IntentType;
  confidence: number;
  reply: string;
  products?: ProductItem[];
  suggestedProducts?: ProductItem[];
  orderTimeline?: OrderTimelineResult | null;
  metadata?: Record<string, any>;
}

export interface StreamPayload {
  type: 'meta' | 'chunk' | 'done' | 'error';
  conversationId?: string;
  intent?: IntentType;
  confidence?: number;
  products?: ProductItem[];
  orderTimeline?: OrderTimelineResult | null;
  content?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly intentService: IntentService,
    @Inject(STORE_PROVIDER)
    private readonly storeProvider: IStoreProvider,
    private readonly llmService: LlmService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Helper to create a RunnableWithMessageHistory chain backed by RedisChatMessageHistory
   */
  private createHistoryRunnable() {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', '{systemContext}'],
      new MessagesPlaceholder('chat_history'),
      ['human', '{input}'],
    ]);

    const chain = prompt.pipe(this.llmService.getModel());

    return new RunnableWithMessageHistory({
      runnable: chain,
      getMessageHistory: async (sessionId: string) => {
        const [tenantId, conversationId] = sessionId.split(':');
        return new RedisChatMessageHistory({
          tenantId,
          conversationId,
          redisService: this.redisService,
          prisma: this.prisma,
          ttlSeconds: 86400, // 24 hours
        });
      },
      inputMessagesKey: 'input',
      historyMessagesKey: 'chat_history',
    });
  }

  /**
   * Main conversational orchestrator:
   * 1. Classifies intent of user input.
   * 2. Retrieves store data (Products or Order Timeline) from active StoreProvider.
   * 3. Synthesizes a response using Groq LLM + LangChain RunnableWithMessageHistory (Redis cached).
   * 4. Persists conversation and message history to PostgreSQL.
   */
  async processMessage(
    tenantId: string,
    userMessage: string,
    conversationId?: string,
  ): Promise<ChatResponse> {
    const activeConversationId = conversationId || randomUUID();
    this.logger.log(
      `Processing message for tenant [${tenantId}], conversation [${activeConversationId}]: "${userMessage}"`,
    );

    // 1. Intent Recognition
    const intentResult: IntentResult = await this.intentService.classifyIntent(userMessage);
    const { intent, confidence, extracted_query } = intentResult;

    this.logger.log(
      `Detected Intent: ${intent} (Confidence: ${(confidence * 100).toFixed(1)}%, Query: "${extracted_query}")`,
    );

    // 2. Prepare Context & Retrieve Data via StoreProvider
    const { systemContext, products, orderTimeline, metadata } = await this.prepareContext(
      tenantId,
      userMessage,
      intentResult,
    );

    // 3. Synthesize LLM Response via LangChain chain with Redis history
    const runnableChain = this.createHistoryRunnable();
    const sessionId = `${tenantId}:${activeConversationId}`;

    const response = await runnableChain.invoke(
      {
        systemContext,
        input: userMessage,
      },
      {
        configurable: { sessionId },
      },
    );

    const reply =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    // 4. Asynchronously persist conversation & messages to PostgreSQL (non-blocking)
    this.persistHistory(tenantId, activeConversationId, userMessage, reply).catch((err) => {
      this.logger.warn(`Failed to persist chat message to PostgreSQL: ${err.message}`);
    });

    return {
      conversationId: activeConversationId,
      intent,
      confidence,
      reply,
      products,
      suggestedProducts: products,
      orderTimeline,
      metadata,
    };
  }

  /**
   * Real-time SSE Token Streaming Orchestrator with LangChain Redis History
   */
  streamMessage(
    tenantId: string,
    userMessage: string,
    conversationId?: string,
  ): Observable<MessageEvent> {
    const activeConversationId = conversationId || randomUUID();

    return new Observable<MessageEvent>((subscriber) => {
      (async () => {
        try {
          const intentResult: IntentResult = await this.intentService.classifyIntent(userMessage);
          const { intent, confidence } = intentResult;

          const { systemContext, products, orderTimeline, metadata } =
            await this.prepareContext(tenantId, userMessage, intentResult);

          // Emit Metadata Event
          subscriber.next({
            data: JSON.stringify({
              type: 'meta',
              conversationId: activeConversationId,
              intent,
              confidence,
              products,
              orderTimeline,
              metadata,
            } as StreamPayload),
          });

          // Stream LLM tokens via RunnableWithMessageHistory
          const runnableChain = this.createHistoryRunnable();
          const sessionId = `${tenantId}:${activeConversationId}`;

          const stream = await runnableChain.stream(
            {
              systemContext,
              input: userMessage,
            },
            {
              configurable: { sessionId },
            },
          );

          let fullReply = '';

          for await (const chunk of stream) {
            const token =
              typeof chunk.content === 'string'
                ? chunk.content
                : JSON.stringify(chunk.content);

            if (token) {
              fullReply += token;
              subscriber.next({
                data: JSON.stringify({
                  type: 'chunk',
                  content: token,
                } as StreamPayload),
              });
            }
          }

          // Persist history in PostgreSQL in background
          this.persistHistory(tenantId, activeConversationId, userMessage, fullReply).catch(
            (err) => {
              this.logger.warn(`Failed to persist stream chat history to PostgreSQL: ${err.message}`);
            },
          );

          // Emit Done Event
          subscriber.next({
            data: JSON.stringify({
              type: 'done',
              conversationId: activeConversationId,
            } as StreamPayload),
          });
          subscriber.complete();
        } catch (error) {
          this.logger.error(`Error during streamMessage: ${error.message}`);
          subscriber.next({
            data: JSON.stringify({
              type: 'error',
              content: 'An error occurred while generating the response.',
            } as StreamPayload),
          });
          subscriber.error(error);
        }
      })();
    });
  }

  /**
   * Prepares system prompt and context by querying the pluggable StoreProvider
   */
  private async prepareContext(
    tenantId: string,
    userMessage: string,
    intentResult: IntentResult,
  ): Promise<{
    systemContext: string;
    products?: ProductItem[];
    orderTimeline?: OrderTimelineResult | null;
    metadata?: Record<string, any>;
  }> {
    const { intent, extracted_query } = intentResult;

    switch (intent) {
      case IntentType.QUERY_PRODUCT: {
        const searchQuery = extracted_query || userMessage;
        const products: ProductItem[] = await this.storeProvider.getProductList(
          tenantId,
          searchQuery,
          4,
        );

        let systemContext = `You are a helpful and knowledgeable E-Commerce AI Assistant.
The customer is asking about products in our store.`;

        if (products.length > 0) {
          const formattedCatalog = products
            .map(
              (p, idx) =>
                `${idx + 1}. Product: "${p.name}" (ID: ${p.id})\n   Price: $${p.price}\n   Category: ${p.category || 'N/A'}\n   Description: ${p.description || 'N/A'}\n   Attributes: ${JSON.stringify(p.attributes || {})}`,
            )
            .join('\n\n');

          systemContext += `\n\nRELEVANT PRODUCTS FOUND IN STORE CATALOG:\n${formattedCatalog}\n
INSTRUCTIONS:
1. Recommend and describe the matching products above in a friendly, conversational tone.
2. Highlight key features, colors, and prices accurately based ONLY on the provided catalog data.
3. If multiple options match, briefly compare them to help the customer decide.
4. Keep the reply concise, professional, and engaging.`;
        } else {
          systemContext += `\n\nNO MATCHING PRODUCTS FOUND in our catalog for "${searchQuery}".
INSTRUCTIONS:
1. Politely let the customer know we couldn't find an exact match in our current inventory.
2. Ask if they would like to search for a related category or need help finding something else.`;
        }

        return {
          systemContext,
          products,
          metadata: { searchQuery, matchedCount: products.length },
        };
      }

      case IntentType.CHECK_ORDER: {
        const orderQuery = extracted_query || this.extractOrderNumber(userMessage) || '10492';
        const orderTimeline = await this.storeProvider.getOrderTimeline(tenantId, orderQuery);

        let systemContext = `You are an E-Commerce Order Support Assistant.
The customer is inquiring about the status of an order.`;

        if (orderTimeline) {
          const stepsSummary = orderTimeline.steps
            .map((s) => `- ${s.title} (${s.timestamp}): Status [${s.status}]`)
            .join('\n');

          systemContext += `\n\nORDER DETAILS FOR #${orderTimeline.orderNumber}:
Overall Status: ${orderTimeline.status}
Customer: ${orderTimeline.customerEmail || 'Verified Customer'}
Total: $${orderTimeline.totalAmount || 0}
Tracking Steps:
${stepsSummary}

INSTRUCTIONS:
1. Provide a reassuring and clear update on order #${orderTimeline.orderNumber}.
2. Mention the current status step and estimated delivery time clearly.
3. Keep the response concise and friendly.`;
        } else {
          systemContext += `\n\nNo order record was found for ID "${orderQuery}".
INSTRUCTIONS:
1. Politely ask the customer to double-check their order number or provide their purchase email.`;
        }

        return {
          systemContext,
          orderTimeline,
          metadata: { orderId: orderQuery, found: !!orderTimeline },
        };
      }

      case IntentType.ADD_TO_CART: {
        const systemContext = `You are a helpful E-Commerce Shopping Assistant.
The customer wants to add an item to their shopping cart.
Acknowledge the item ("${extracted_query || 'the selected item'}") enthusiastically and confirm it can be added to their bag.
Ask if they would like to review size/color options or proceed to checkout.`;

        return {
          systemContext,
          metadata: { item: extracted_query },
        };
      }

      case IntentType.GREETING: {
        const systemContext = `You are a friendly, welcoming E-Commerce AI Assistant.
Respond warmly to the customer's greeting. Introduce yourself briefly and ask how you can help them today with products, recommendations, or orders.
Keep it under 2-3 sentences.`;

        return { systemContext };
      }

      case IntentType.UNKNOWN:
      default: {
        const systemContext = `You are an E-Commerce Store AI Assistant.
The customer's message might be ambiguous, general, or outside our standard shopping scope.
Respond politely, acknowledge their message, and guide them on what you can assist with (e.g., finding products, checking orders, recommending gear).`;

        return { systemContext };
      }
    }
  }

  private extractOrderNumber(text: string): string | null {
    const match = text.match(/#?([0-9]{4,8})/);
    return match ? match[1] : null;
  }

  /**
   * Saves message into conversation table in PostgreSQL
   */
  private async persistHistory(
    tenantId: string,
    conversationId: string,
    userMessage: string,
    assistantReply: string,
  ): Promise<void> {
    try {
      // Ensure tenant exists
      await this.prisma.tenant.upsert({
        where: { id: tenantId },
        update: {},
        create: { id: tenantId, name: 'Default Store' },
      });

      // Find or create conversation for the specific conversationId
      let conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
      });

      if (!conversation) {
        conversation = await this.prisma.conversation.create({
          data: {
            id: conversationId,
            tenantId,
          },
        });
      }

      // Create User and Assistant message records in PostgreSQL
      await this.prisma.message.createMany({
        data: [
          {
            conversationId: conversation.id,
            senderType: 'USER',
            content: userMessage,
          },
          {
            conversationId: conversation.id,
            senderType: 'ASSISTANT',
            content: assistantReply,
          },
        ],
      });
    } catch (err) {
      this.logger.warn(`Could not persist chat history to PostgreSQL: ${err.message}`);
    }
  }
}
