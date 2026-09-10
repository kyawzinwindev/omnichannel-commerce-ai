import { Injectable, Logger } from '@nestjs/common';
import { IntentService, IntentType, IntentResult } from './intent.service';
import { VectorSearchService, ScoredProduct } from './vector-search.service';
import { LlmService } from './llm.service';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  intent: IntentType;
  confidence: number;
  reply: string;
  suggestedProducts?: ScoredProduct[];
  metadata?: Record<string, any>;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly intentService: IntentService,
    private readonly vectorSearchService: VectorSearchService,
    private readonly llmService: LlmService,
  ) {}

  /**
   * Main conversational orchestrator:
   * 1. Classifies intent of user input.
   * 2. Retrieves vector-grounded RAG context when appropriate.
   * 3. Synthesizes a response using Groq LLM.
   */
  async processMessage(
    tenantId: string,
    userMessage: string,
    conversationHistory: ChatMessage[] = [],
  ): Promise<ChatResponse> {
    this.logger.log(`Processing message for tenant [${tenantId}]: "${userMessage}"`);

    // Step 1: Intent Recognition
    const intentResult: IntentResult = await this.intentService.classifyIntent(userMessage);
    const { intent, confidence, extracted_query } = intentResult;

    this.logger.log(
      `Detected Intent: ${intent} (Confidence: ${(confidence * 100).toFixed(1)}%, Query: "${extracted_query}")`,
    );

    // Step 2: Route by Intent
    switch (intent) {
      case IntentType.QUERY_PRODUCT:
        return await this.handleProductQuery(tenantId, userMessage, extracted_query, intentResult, conversationHistory);

      case IntentType.CHECK_ORDER:
        return await this.handleCheckOrder(userMessage, extracted_query, intentResult, conversationHistory);

      case IntentType.ADD_TO_CART:
        return await this.handleAddToCart(userMessage, extracted_query, intentResult, conversationHistory);

      case IntentType.GREETING:
        return await this.handleGreeting(userMessage, intentResult, conversationHistory);

      case IntentType.UNKNOWN:
      default:
        return await this.handleFallback(userMessage, intentResult, conversationHistory);
    }
  }

  /**
   * Handles product searches with Vector RAG
   */
  private async handleProductQuery(
    tenantId: string,
    userMessage: string,
    extractedQuery: string | null,
    intentResult: IntentResult,
    conversationHistory: ChatMessage[],
  ): Promise<ChatResponse> {
    const searchQuery = extractedQuery || userMessage;
    const products: ScoredProduct[] = await this.vectorSearchService.searchSimilarProducts(
      tenantId,
      searchQuery,
      4,
      0.35,
    );

    let systemContext = `You are a helpful and knowledgeable E-Commerce AI Assistant.
The customer is asking about products in our store.`;

    if (products.length > 0) {
      const formattedCatalog = products
        .map(
          (p, idx) =>
            `${idx + 1}. Product: "${p.name}" (ID: ${p.id})\n   Price: $${p.price}\n   Category: ${p.category || 'N/A'}\n   Description: ${p.description || 'N/A'}\n   Attributes: ${JSON.stringify(p.attributes || {})}\n   Match Relevance: ${(p.similarity * 100).toFixed(1)}%`,
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

    const messages: ChatMessage[] = [
      { role: 'system', content: systemContext },
      ...conversationHistory.slice(-4),
      { role: 'user', content: userMessage },
    ];

    const reply = await this.llmService.generateResponse(messages);

    return {
      intent: IntentType.QUERY_PRODUCT,
      confidence: intentResult.confidence,
      reply,
      suggestedProducts: products,
      metadata: {
        searchQuery,
        matchedCount: products.length,
      },
    };
  }

  /**
   * Handles order status tracking inquiries
   */
  private async handleCheckOrder(
    userMessage: string,
    extractedQuery: string | null,
    intentResult: IntentResult,
    conversationHistory: ChatMessage[],
  ): Promise<ChatResponse> {
    const systemContext = `You are an E-Commerce Order Support Assistant.
The customer is inquiring about the status of an order.
If they provided an order ID (like "${extractedQuery || ''}"), acknowledge it warmly and let them know you are checking the latest shipping and delivery updates.
If no order ID was provided, politely ask them for their order number or the email address used during purchase.
Keep the tone reassuring and concise.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemContext },
      ...conversationHistory.slice(-4),
      { role: 'user', content: userMessage },
    ];

    const reply = await this.llmService.generateResponse(messages);

    return {
      intent: IntentType.CHECK_ORDER,
      confidence: intentResult.confidence,
      reply,
      metadata: {
        orderId: extractedQuery,
      },
    };
  }

  /**
   * Handles add to cart intents
   */
  private async handleAddToCart(
    userMessage: string,
    extractedQuery: string | null,
    intentResult: IntentResult,
    conversationHistory: ChatMessage[],
  ): Promise<ChatResponse> {
    const systemContext = `You are a helpful E-Commerce Shopping Assistant.
The customer wants to add an item to their shopping cart.
Acknowledge the item ("${extractedQuery || 'the selected item'}") enthusiastically and confirm it can be added to their bag.
Ask if they would like to review size/color options or proceed to checkout.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemContext },
      ...conversationHistory.slice(-4),
      { role: 'user', content: userMessage },
    ];

    const reply = await this.llmService.generateResponse(messages);

    return {
      intent: IntentType.ADD_TO_CART,
      confidence: intentResult.confidence,
      reply,
      metadata: {
        item: extractedQuery,
      },
    };
  }

  /**
   * Handles greetings and pleasantries
   */
  private async handleGreeting(
    userMessage: string,
    intentResult: IntentResult,
    conversationHistory: ChatMessage[],
  ): Promise<ChatResponse> {
    const systemContext = `You are a friendly, welcoming E-Commerce AI Assistant.
Respond warmly to the customer's greeting. Introduce yourself briefly and ask how you can help them today with products, recommendations, or orders.
Keep it under 2-3 sentences.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemContext },
      ...conversationHistory.slice(-4),
      { role: 'user', content: userMessage },
    ];

    const reply = await this.llmService.generateResponse(messages);

    return {
      intent: IntentType.GREETING,
      confidence: intentResult.confidence,
      reply,
    };
  }

  /**
   * Handles fallback and out-of-scope inquiries
   */
  private async handleFallback(
    userMessage: string,
    intentResult: IntentResult,
    conversationHistory: ChatMessage[],
  ): Promise<ChatResponse> {
    const systemContext = `You are an E-Commerce Store AI Assistant.
The customer's message might be ambiguous, general, or outside our standard shopping scope.
Respond politely, acknowledge their message, and guide them on what you can assist with (e.g., finding products, checking orders, recommending gear).`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemContext },
      ...conversationHistory.slice(-4),
      { role: 'user', content: userMessage },
    ];

    const reply = await this.llmService.generateResponse(messages);

    return {
      intent: IntentType.UNKNOWN,
      confidence: intentResult.confidence,
      reply,
    };
  }
}
