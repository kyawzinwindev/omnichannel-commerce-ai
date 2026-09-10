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
import { Observable } from 'rxjs';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
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
  ) {}

  /**
   * Main conversational orchestrator:
   * 1. Classifies intent of user input.
   * 2. Retrieves store data (Products or Order Timeline) from active StoreProvider.
   * 3. Synthesizes a response using Groq LLM.
   * 4. Persists conversation and message history.
   */
  async processMessage(
    tenantId: string,
    userMessage: string,
    conversationHistory: ChatMessage[] = [],
  ): Promise<ChatResponse> {
    this.logger.log(`Processing message for tenant [${tenantId}]: "${userMessage}"`);

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

    // 3. Synthesize LLM Response
    const messages: ChatMessage[] = [
      { role: 'system', content: systemContext },
      ...conversationHistory.slice(-4),
      { role: 'user', content: userMessage },
    ];

    const reply = await this.llmService.generateResponse(messages);

    // 4. Asynchronously persist conversation & messages (non-blocking)
    this.persistHistory(tenantId, userMessage, reply).catch((err) => {
      this.logger.warn(`Failed to persist chat message: ${err.message}`);
    });

    return {
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
   * Real-time SSE Token Streaming Orchestrator
   */
  streamMessage(
    tenantId: string,
    userMessage: string,
    conversationHistory: ChatMessage[] = [],
  ): Observable<MessageEvent> {
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
              intent,
              confidence,
              products,
              orderTimeline,
              metadata,
            } as StreamPayload),
          });

          // Stream LLM tokens
          const messages: ChatMessage[] = [
            { role: 'system', content: systemContext },
            ...conversationHistory.slice(-4),
            { role: 'user', content: userMessage },
          ];

          const stream = await this.llmService.streamResponse(messages);
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

          // Persist history in background
          this.persistHistory(tenantId, userMessage, fullReply).catch((err) => {
            this.logger.warn(`Failed to persist stream chat history: ${err.message}`);
          });

          // Emit Done Event
          subscriber.next({
            data: JSON.stringify({ type: 'done' } as StreamPayload),
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
    userMessage: string,
    assistantReply: string,
  ): Promise<void> {
    try {
      // Find or create default conversation for tenant
      let conversation = await this.prisma.conversation.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });

      if (!conversation) {
        // Ensure tenant exists
        await this.prisma.tenant.upsert({
          where: { id: tenantId },
          update: {},
          create: { id: tenantId, name: 'Default Store' },
        });

        conversation = await this.prisma.conversation.create({
          data: { tenantId },
        });
      }

      // Create User and Assistant message records
      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: 'USER',
          content: userMessage,
        },
      });

      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: 'ASSISTANT',
          content: assistantReply,
        },
      });
    } catch (err) {
      this.logger.warn(`Could not persist chat history: ${err.message}`);
    }
  }
}
