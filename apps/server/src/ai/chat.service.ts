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
import { ChatStage, UserSessionState } from '../redis/session-state';
import { buildStageAwareSystemPrompt } from './chat-response.prompt';

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
   * Main conversational orchestrator with Redis State-Driven Session Flow
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
      // 1. Fetch existing session state from Redis
      let session = await this.redisService.getSessionState(tenantId, activeConversationId);

      // 2. Classify intent with stage awareness
      const intentResult = await this.intentService.classifyIntent(
        userMessage,
        session.stage,
        session.draftOrder,
      );

      this.logger.log(
        `Detected Intent: ${intentResult.intent} (Confidence: ${(intentResult.confidence * 100).toFixed(1)}%, Stage: ${session.stage})`,
      );

      // 3. Process State Machine & Store Data
      const { systemContext, products, orderSummary, updatedSession, metadata } =
        await this.handleSessionAndContext(
          tenantId,
          userMessage,
          intentResult,
          session,
          activeConversationId,
        );

      session = updatedSession;

      // 4. Synthesize LLM Response via LangChain chain with Redis history
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

      // 5. Decouple DB persistence: dispatch background job to BullMQ queue immediately
      this.chatPersistenceQueue
        .add('save-history', {
          tenantId,
          conversationId: activeConversationId,
          userMessage,
          aiResponse: reply,
          metadata: { ...metadata, stage: session.stage },
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
        intent: intentResult.intent,
        confidence: intentResult.confidence,
        reply,
        products,
        suggestedProducts: products,
        orderSummary,
        metadata: { ...metadata, stage: session.stage },
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
   * Real-time SSE Token Streaming Orchestrator with Redis Session Flow
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
          // 1. Fetch existing session state from Redis
          let session = await this.redisService.getSessionState(tenantId, activeConversationId);

          // 2. Classify intent with stage awareness
          const intentResult = await this.intentService.classifyIntent(
            userMessage,
            session.stage,
            session.draftOrder,
          );

          // 3. Process State Machine & Store Data
          const { systemContext, products, orderSummary, updatedSession, metadata } =
            await this.handleSessionAndContext(
              tenantId,
              userMessage,
              intentResult,
              session,
              activeConversationId,
            );

          session = updatedSession;

          // 4. Emit Metadata Event
          subscriber.next({
            data: JSON.stringify({
              type: 'meta',
              conversationId: activeConversationId,
              intent: intentResult.intent,
              confidence: intentResult.confidence,
              products,
              orderSummary,
              metadata: { ...metadata, stage: session.stage },
            } as StreamPayload),
          });

          // 5. Stream LLM tokens via RunnableWithMessageHistory
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

          // 6. Decouple DB persistence: dispatch background job to BullMQ queue immediately
          this.chatPersistenceQueue
            .add('save-history', {
              tenantId,
              conversationId: activeConversationId,
              userMessage,
              aiResponse: fullReply,
              metadata: { ...metadata, stage: session.stage },
            })
            .then((job) => {
              this.logger.log(
                `Enqueued background DB persistence job [${job.id}] for streamed conv [${activeConversationId}]`,
              );
            })
            .catch((err) => {
              this.logger.warn(`Failed to enqueue stream chat persistence job to BullMQ: ${err.message}`);
            });

          // 7. Emit Done Event
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
   * Orchestrates the State Machine transitions and loads store data
   */
  private async handleSessionAndContext(
    tenantId: string,
    userMessage: string,
    intentResult: IntentResult,
    session: UserSessionState,
    conversationId: string,
  ): Promise<{
    systemContext: string;
    products?: ProductItem[];
    orderSummary?: OrderSummaryResult | null;
    updatedSession: UserSessionState;
    metadata?: Record<string, any>;
  }> {
    const { intent, extracted_query, extracted_info } = intentResult;
    let products: ProductItem[] | undefined = undefined;
    let orderSummary: OrderSummaryResult | null | undefined = undefined;

    // 1. Handle State Transitions based on Intent & Current Stage
    if (intent === IntentType.CANCEL_ORDER) {
      session.stage = ChatStage.IDLE;
      session.cart = [];
      session.draftOrder = {};
      await this.redisService.clearSessionState(tenantId, conversationId);
    } else if (intent === IntentType.ADD_TO_CART) {
      const searchTarget = extracted_query || userMessage;
      const matchedProducts = await this.storeProvider.getProductList(tenantId, searchTarget, 1);
      const topProduct = matchedProducts[0] || {
        id: `item-${Date.now()}`,
        name: extracted_query || 'Selected Product',
        price: 128.0,
        inStock: true,
      };

      const quantity = extracted_info?.quantity || 1;
      const existingItem = session.cart.find(
        (c) => c.productId === topProduct.id || c.name.toLowerCase() === topProduct.name.toLowerCase(),
      );

      if (existingItem) {
        existingItem.quantity += quantity;
      } else {
        session.cart.push({
          productId: topProduct.id,
          name: topProduct.name,
          price: Number(topProduct.price),
          quantity,
        });
      }

      session.stage = ChatStage.COLLECTING_USER_INFO;
    } else if (
      session.stage === ChatStage.COLLECTING_USER_INFO ||
      intent === IntentType.COLLECT_INFO
    ) {
      if (extracted_info) {
        if (extracted_info.name && !session.draftOrder.name) {
          session.draftOrder.name = extracted_info.name;
        }
        if (extracted_info.phone) {
          session.draftOrder.phone = extracted_info.phone;
        }
        if (extracted_info.address) {
          session.draftOrder.address = extracted_info.address;
        }
      }

      // Check if all 3 fields are provided -> transition to CONFIRMING_ORDER
      if (session.draftOrder.name && session.draftOrder.phone && session.draftOrder.address) {
        session.stage = ChatStage.CONFIRMING_ORDER;
      }
    } else if (
      session.stage === ChatStage.CONFIRMING_ORDER &&
      intent === IntentType.CONFIRM_ORDER
    ) {
      // User confirms order! Create the order and reset session
      const orderNumber = `ORD-${Math.floor(10000 + Math.random() * 90000)}`;
      const totalAmount =
        session.cart.reduce((sum, item) => sum + item.price * item.quantity, 0) || 128.0;

      orderSummary = {
        orderNumber,
        status: 'accepted',
        customerName: session.draftOrder.name || 'Valued Customer',
        shippingAddress: `${session.draftOrder.address} (Phone: ${session.draftOrder.phone || 'N/A'})`,
        items:
          session.cart.length > 0
            ? session.cart.map((c, i) => ({
                id: c.productId || `item-${i + 1}`,
                name: c.name,
                quantity: c.quantity,
                price: c.price,
              }))
            : [{ id: 'item-1', name: 'Store Product', quantity: 1, price: totalAmount }],
        totalAmount,
        orderDate: new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      };

      try {
        await this.prisma.order.create({
          data: {
            tenantId,
            orderNumber,
            customerEmail: session.draftOrder.phone
              ? `${session.draftOrder.phone.replace(/[^0-9]/g, '')}@customer.local`
              : 'customer@store.local',
            totalAmount,
            status: 'accepted',
          },
        });
      } catch (dbErr) {
        this.logger.debug(`Could not save order to Prisma: ${dbErr.message}`);
      }

      // Clear session from Redis
      await this.redisService.clearSessionState(tenantId, conversationId);
      session = {
        stage: ChatStage.IDLE,
        cart: [],
        draftOrder: {},
      };
    }

    // Persist updated session state if not in cleared idle state
    if (session.stage !== ChatStage.IDLE || session.cart.length > 0) {
      await this.redisService.setSessionState(tenantId, conversationId, session);
    }

    // 2. Fetch Catalog / Order Data as needed
    if (intent === IntentType.GENERAL_CATALOG_QUERY) {
      products = await this.storeProvider.getProductList(tenantId, undefined, 4);
    } else if (intent === IntentType.QUERY_PRODUCT) {
      const searchQuery = extracted_query || userMessage;
      products = await this.storeProvider.getProductList(tenantId, searchQuery, 4);
    } else if (intent === IntentType.CHECK_ORDER) {
      const orderQuery = extracted_query || this.extractOrderNumber(userMessage) || '10492';
      orderSummary = await this.storeProvider.getOrderSummary(tenantId, orderQuery);
    }

    // 3. Build Stage-Aware System Prompt
    const systemContext = buildStageAwareSystemPrompt({
      intent,
      session,
      products,
      orderSummary,
      searchQuery: extracted_query,
    });

    return {
      systemContext,
      products,
      orderSummary,
      updatedSession: session,
      metadata: { intent, stage: session.stage },
    };
  }

  private extractOrderNumber(text: string): string | null {
    const match = text.match(/#?([0-9]{4,8})/);
    return match ? match[1] : null;
  }
}
