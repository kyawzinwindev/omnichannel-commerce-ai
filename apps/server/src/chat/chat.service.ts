import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IntentService, IntentType, IntentResult } from './intent.service';
import { LlmService } from './llm.service';
import {
  IStoreProvider,
  OrderSummaryResult,
  ProductItem,
  STORE_PROVIDER,
} from '../products/interfaces/store-provider.interface';
import { PrismaService } from '../database/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { RedisService } from '../redis/redis.service';
import { RedisChatMessageHistory } from '../redis/redis-chat-history';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { RunnableWithMessageHistory } from '@langchain/core/runnables';
import { randomUUID } from 'crypto';
import { ChatStage, UserSessionState } from '../redis/session-state';
import { buildStageAwareSystemPrompt } from './chat-response.prompt';

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

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly intentService: IntentService,
    @Inject(STORE_PROVIDER)
    private readonly storeProvider: IStoreProvider,
    private readonly llmService: LlmService,
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly redisService: RedisService,
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

    const chain = prompt.pipe(this.llmService.getResponseModel());

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

      // Remember what we just said so the next drifting message can be re-anchored
      session.lastBotMessage = reply.slice(0, 300);
      if (this.shouldPersistSession(session)) {
        await this.redisService.setSessionState(tenantId, activeConversationId, session);
      }

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

    // Context from BEFORE this turn (what the conversation was about)
    const prevLastAction = session.lastAction ?? null;
    const prevLastViewedProduct = session.lastViewedProduct ?? null;
    const prevLastBotMessage = session.lastBotMessage ?? null;
    const isDrift = intent === IntentType.CHIT_CHAT || intent === IntentType.UNKNOWN;

    // 1. Handle State Transitions based on Intent & Current Stage
    if (intent === IntentType.CANCEL_ORDER) {
      session.stage = ChatStage.IDLE;
      session.cart = [];
      session.draftOrder = {};
      session.lastAction = undefined;
      session.lastViewedProduct = undefined;
      session.lastBotMessage = undefined;
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

      await this.ordersService.create({
        tenantId,
        orderNumber,
        status: 'accepted',
        customer: session.draftOrder,
        cart: session.cart,
        totalAmount,
      });

      // Clear session from Redis
      await this.redisService.clearSessionState(tenantId, conversationId);
      session = {
        stage: ChatStage.IDLE,
        cart: [],
        draftOrder: {},
      };
    }

    // Fetch Catalog / Order Data first so we can remember the viewed product
    if (intent === IntentType.GENERAL_CATALOG_QUERY) {
      products = await this.storeProvider.getProductList(tenantId, undefined, 4);
    } else if (intent === IntentType.QUERY_PRODUCT) {
      const searchQuery = extracted_query || userMessage;
      products = await this.storeProvider.getProductList(tenantId, searchQuery, 4);
      if (products.length > 0) {
        session.lastViewedProduct = { id: products[0].id, name: products[0].name };
      }
    } else if (intent === IntentType.CHECK_ORDER) {
      const orderQuery = extracted_query || this.extractOrderNumber(userMessage) || '10492';
      orderSummary = await this.storeProvider.getOrderSummary(tenantId, orderQuery);
    }

    // Chit-chat / fragments never overwrite the conversational anchor
    if (!isDrift && intent !== IntentType.CONFIRM_ORDER && intent !== IntentType.CANCEL_ORDER) {
      session.lastAction = intent;
    }
    if (intent === IntentType.ADD_TO_CART && session.cart.length > 0) {
      const last = session.cart[session.cart.length - 1];
      session.lastViewedProduct = { id: last.productId, name: last.name };
    }
    if (session.stage === ChatStage.IDLE && session.cart.length === 0 && intent === IntentType.CONFIRM_ORDER) {
      session.lastViewedProduct = undefined;
      session.lastAction = undefined;
    }

    // Persist updated session state (skip when fully reset/empty)
    if (this.shouldPersistSession(session)) {
      await this.redisService.setSessionState(tenantId, conversationId, session);
    }

    // 3. Build Stage-Aware System Prompt
    const systemContext = buildStageAwareSystemPrompt({
      intent,
      session,
      products,
      orderSummary,
      searchQuery: extracted_query,
      lastAction: prevLastAction,
      lastViewedProduct: prevLastViewedProduct ?? session.lastViewedProduct ?? null,
      lastBotMessage: prevLastBotMessage,
    });

    return {
      systemContext,
      products,
      orderSummary,
      updatedSession: session,
      metadata: { intent, stage: session.stage },
    };
  }

  private shouldPersistSession(session: UserSessionState): boolean {
    return (
      session.stage !== ChatStage.IDLE ||
      session.cart.length > 0 ||
      !!session.lastViewedProduct ||
      !!session.lastAction
    );
  }

  private extractOrderNumber(text: string): string | null {
    const match = text.match(/#?([0-9]{4,8})/);
    return match ? match[1] : null;
  }
}
