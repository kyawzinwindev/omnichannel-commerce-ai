import { Inject, Injectable, Logger, MessageEvent } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IntentService, IntentType, IntentResult } from './intent.service';
import { LlmService } from './llm.service';
import {
  IStoreProvider,
  OrderSummaryResult,
  ProductItem,
  STORE_PROVIDER,
} from '../store/interfaces/store-provider.interface';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RedisChatMessageHistory } from '../redis/redis-chat-history';
import { VectorSearchService, ScoredProduct } from './vector-search.service';
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
  orderSummary?: OrderSummaryResult | null;
  metadata?: Record<string, any>;
}

export interface StreamPayload {
  type: 'meta' | 'chunk' | 'done' | 'error';
  conversationId?: string;
  intent?: IntentType;
  confidence?: number;
  products?: ProductItem[];
  orderSummary?: OrderSummaryResult | null;
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
    private readonly vectorSearchService: VectorSearchService,
    @InjectQueue('chat-persistence')
    private readonly chatPersistenceQueue: Queue,
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
   * 1. Parallel pre-execution (Intent recognition, initial vector context, and Redis history warming).
   * 2. Retrieves store data (Products or Order Summary) from active StoreProvider.
   * 3. Synthesizes a response using LLM + LangChain RunnableWithMessageHistory.
   * 4. Enqueues background persistence to BullMQ queue without blocking response delivery.
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

    try {
      // 1. Parallel Pre-execution: Intent Recognition, Vector Store Context & Redis Memory Retrieval
      const [intentResult, initialVectorProducts] = await Promise.all([
        this.intentService.classifyIntent(userMessage),
        this.vectorSearchService
          .searchSimilarProducts(tenantId, userMessage, 4, 0.3)
          .catch((err) => {
            this.logger.debug(`Initial vector search fallback/skipped: ${err.message}`);
            return [] as ScoredProduct[];
          }),
        this.redisService
          .lrange(`chat:history:${tenantId}:${activeConversationId}`, 0, -1)
          .catch(() => [] as string[]),
      ]);

      const { intent, confidence, extracted_query } = intentResult;

      this.logger.log(
        `Detected Intent: ${intent} (Confidence: ${(confidence * 100).toFixed(1)}%, Query: "${extracted_query}")`,
      );

      // 2. Prepare Context & Retrieve Data via StoreProvider
      const { systemContext, products, orderSummary, metadata } = await this.prepareContext(
        tenantId,
        userMessage,
        intentResult,
        initialVectorProducts,
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

      // 4. Decouple DB persistence: dispatch background job to BullMQ queue immediately
      this.chatPersistenceQueue
        .add('save-history', {
          tenantId,
          conversationId: activeConversationId,
          userMessage,
          aiResponse: reply,
          metadata,
        })
        .then((job) => {
          this.logger.log(
            `Enqueued background DB persistence job [${job.id}] for conversation [${activeConversationId}]`,
          );
        })
        .catch((err) => {
          this.logger.warn(`Failed to enqueue chat persistence job to BullMQ: ${err.message}`);
        });

      return {
        conversationId: activeConversationId,
        intent,
        confidence,
        reply,
        products,
        suggestedProducts: products,
        orderSummary,
        metadata,
      };
    } catch (error) {
      this.logger.warn(
        `Error during processMessage for tenant [${tenantId}], conv [${activeConversationId}]: ${error.message}`,
      );

      const fallbackReply =
        "Hello! I'm your AI store assistant. I'm currently having trouble reaching all catalog services, but I'm here to help you. How can I assist you today?";

      return {
        conversationId: activeConversationId,
        intent: IntentType.UNKNOWN,
        confidence: 0.0,
        reply: fallbackReply,
        products: [],
        suggestedProducts: [],
        orderSummary: null,
        metadata: { fallback: true, error: error.message },
      };
    }
  }

  /**
   * Real-time SSE Token Streaming Orchestrator with LangChain Redis History & Decoupled BullMQ Persistence
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
          // Parallel Pre-execution: Intent Recognition, Vector Store Context & Redis Memory Retrieval
          const [intentResult, initialVectorProducts] = await Promise.all([
            this.intentService.classifyIntent(userMessage),
            this.vectorSearchService
              .searchSimilarProducts(tenantId, userMessage, 4, 0.3)
              .catch((err) => {
                this.logger.debug(`Initial vector search fallback/skipped: ${err.message}`);
                return [] as ScoredProduct[];
              }),
            this.redisService
              .lrange(`chat:history:${tenantId}:${activeConversationId}`, 0, -1)
              .catch(() => [] as string[]),
          ]);

          const { intent, confidence } = intentResult;

          const { systemContext, products, orderSummary, metadata } =
            await this.prepareContext(tenantId, userMessage, intentResult, initialVectorProducts);

          // Emit Metadata Event
          subscriber.next({
            data: JSON.stringify({
              type: 'meta',
              conversationId: activeConversationId,
              intent,
              confidence,
              products,
              orderSummary,
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

          // Decouple DB persistence: dispatch background job to BullMQ queue immediately
          this.chatPersistenceQueue
            .add('save-history', {
              tenantId,
              conversationId: activeConversationId,
              userMessage,
              aiResponse: fullReply,
              metadata,
            })
            .then((job) => {
              this.logger.log(
                `Enqueued background DB persistence job [${job.id}] for streamed conv [${activeConversationId}]`,
              );
            })
            .catch((err) => {
              this.logger.warn(`Failed to enqueue stream chat persistence job to BullMQ: ${err.message}`);
            });

          // Emit Done Event
          subscriber.next({
            data: JSON.stringify({
              type: 'done',
              conversationId: activeConversationId,
            } as StreamPayload),
          });
          subscriber.complete();
        } catch (error) {
          this.logger.warn(`Error during streamMessage: ${error.message}`);
          subscriber.next({
            data: JSON.stringify({
              type: 'chunk',
              content:
                "I apologize, but I encountered a temporary issue while streaming the response. Please try asking again!",
            } as StreamPayload),
          });
          subscriber.next({
            data: JSON.stringify({
              type: 'done',
              conversationId: activeConversationId,
            } as StreamPayload),
          });
          subscriber.complete();
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
    initialVectorProducts?: ScoredProduct[],
  ): Promise<{
    systemContext: string;
    products?: ProductItem[];
    orderSummary?: OrderSummaryResult | null;
    metadata?: Record<string, any>;
  }> {
    const { intent, extracted_query } = intentResult;

    const languageInstruction = `\n\nLANGUAGE & TONE GUIDELINES:
- Detect the language of the customer's message and respond fluently in the matching language (Burmese, Thai, or English).
- English: Natural, friendly, and concise.
- Burmese (မြန်မာဘာသာ): Use natural, polite, and grammatically standard Burmese with polite particles (ခင်ဗျာ/ရှင့်).
- Thai (ภาษาไทย): Use natural, polite, and friendly Thai with proper polite particles (ค่ะ/ครับ).
- Retain exact product names, IDs, and numeric prices while speaking in the customer's preferred language.`;

    switch (intent) {
      case IntentType.QUERY_PRODUCT: {
        const searchQuery = extracted_query || userMessage;
        let products: ProductItem[] = [];

        // If pre-fetched vector products match and are available, reuse them
        if (
          initialVectorProducts &&
          initialVectorProducts.length > 0 &&
          (!extracted_query || extracted_query.toLowerCase() === userMessage.toLowerCase())
        ) {
          products = initialVectorProducts.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            price: Number(p.price),
            category: p.category,
            inStock: true,
            attributes: p.attributes,
            similarity: p.similarity,
          }));
        } else {
          products = await this.storeProvider.getProductList(
            tenantId,
            searchQuery,
            4,
          );
        }

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

        systemContext += languageInstruction;

        return {
          systemContext,
          products,
          metadata: { searchQuery, matchedCount: products.length },
        };
      }

      case IntentType.CHECK_ORDER: {
        const orderQuery = extracted_query || this.extractOrderNumber(userMessage) || '10492';
        const orderSummary = await this.storeProvider.getOrderSummary(tenantId, orderQuery);

        let systemContext = `You are an E-Commerce Order Support Assistant.
The customer is inquiring about the status of an order.`;

        if (orderSummary) {
          const itemsList = orderSummary.items
            .map(
              (item, idx) =>
                `${idx + 1}. ${item.name} (Qty: ${item.quantity}) - $${(item.price * item.quantity).toFixed(2)}`,
            )
            .join('\n');

          systemContext += `\n\nORDER SUMMARY DETAILS FOR #${orderSummary.orderNumber}:
Status: ${orderSummary.status.toUpperCase()}
Customer Name: ${orderSummary.customerName || 'Valued Customer'}
Shipping Address: ${orderSummary.shippingAddress || 'N/A'}
Order Date: ${orderSummary.orderDate || 'Recent'}
Items:
${itemsList}
Total Amount: $${orderSummary.totalAmount.toFixed(2)}

INSTRUCTIONS:
1. Provide a clear, professional summary update for order #${orderSummary.orderNumber}.
2. State the order status (${orderSummary.status}), recipient name, shipping address, and purchased item details.
3. Confirm the total amount ($${orderSummary.totalAmount.toFixed(2)}).
4. Keep the response concise and friendly.`;
        } else {
          systemContext += `\n\nNo order record was found for ID "${orderQuery}".
INSTRUCTIONS:
1. Politely ask the customer to double-check their order number or provide their purchase email.`;
        }

        systemContext += languageInstruction;

        return {
          systemContext,
          orderSummary,
          metadata: { orderId: orderQuery, found: !!orderSummary },
        };
      }

      case IntentType.ADD_TO_CART: {
        let systemContext = `You are a helpful E-Commerce Shopping Assistant.
The customer wants to add an item to their shopping cart.
Acknowledge the item ("${extracted_query || 'the selected item'}") enthusiastically and confirm it can be added to their bag.
Ask if they would like to review size/color options or proceed to checkout.`;

        systemContext += languageInstruction;

        return {
          systemContext,
          metadata: { item: extracted_query },
        };
      }

      case IntentType.GREETING: {
        let systemContext = `You are a friendly, welcoming E-Commerce AI Assistant.
Respond warmly to the customer's greeting. Introduce yourself briefly and ask how you can help them today with products, recommendations, or orders.
Keep it under 2-3 sentences.`;

        systemContext += languageInstruction;

        return { systemContext };
      }

      case IntentType.UNKNOWN:
      default: {
        let systemContext = `You are an E-Commerce Store AI Assistant.
The customer's message might be ambiguous, general, or outside our standard shopping scope.
Respond politely, acknowledge their message, and guide them on what you can assist with (e.g., finding products, checking orders, recommending gear).`;

        systemContext += languageInstruction;

        return { systemContext };
      }
    }
  }

  private extractOrderNumber(text: string): string | null {
    const match = text.match(/#?([0-9]{4,8})/);
    return match ? match[1] : null;
  }
}
