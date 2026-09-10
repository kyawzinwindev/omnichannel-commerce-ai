import { Injectable, Logger, MessageEvent } from '@nestjs/common';
import { IntentService, IntentType, IntentResult } from './intent.service';
import { VectorSearchService, ScoredProduct } from './vector-search.service';
import { LlmService } from './llm.service';
import { Observable } from 'rxjs';

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

export interface StreamPayload {
  type: 'meta' | 'chunk' | 'done' | 'error';
  intent?: IntentType;
  confidence?: number;
  suggestedProducts?: ScoredProduct[];
  content?: string;
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
   * Main conversational orchestrator (Standard REST):
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

    const intentResult: IntentResult = await this.intentService.classifyIntent(userMessage);
    const { intent, confidence, extracted_query } = intentResult;

    this.logger.log(
      `Detected Intent: ${intent} (Confidence: ${(confidence * 100).toFixed(1)}%, Query: "${extracted_query}")`,
    );

    const { systemContext, suggestedProducts, metadata } = await this.prepareContext(
      tenantId,
      userMessage,
      intentResult,
    );

    const messages: ChatMessage[] = [
      { role: 'system', content: systemContext },
      ...conversationHistory.slice(-4),
      { role: 'user', content: userMessage },
    ];

    const reply = await this.llmService.generateResponse(messages);

    return {
      intent,
      confidence,
      reply,
      suggestedProducts,
      metadata,
    };
  }

  /**
   * Real-time SSE Token Streaming Orchestrator:
   * Emits meta event (intent + suggested products), token chunks, and completion event.
   */
  streamMessage(
    tenantId: string,
    userMessage: string,
    conversationHistory: ChatMessage[] = [],
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      (async () => {
        try {
          // 1. Intent Recognition
          const intentResult: IntentResult = await this.intentService.classifyIntent(userMessage);
          const { intent, confidence } = intentResult;

          // 2. Prepare Context & RAG retrieval
          const { systemContext, suggestedProducts, metadata } = await this.prepareContext(
            tenantId,
            userMessage,
            intentResult,
          );

          // 3. Emit Metadata Event
          subscriber.next({
            data: JSON.stringify({
              type: 'meta',
              intent,
              confidence,
              suggestedProducts,
              metadata,
            } as StreamPayload),
          });

          // 4. Stream LLM tokens
          const messages: ChatMessage[] = [
            { role: 'system', content: systemContext },
            ...conversationHistory.slice(-4),
            { role: 'user', content: userMessage },
          ];

          const stream = await this.llmService.streamResponse(messages);

          for await (const chunk of stream) {
            const token =
              typeof chunk.content === 'string'
                ? chunk.content
                : JSON.stringify(chunk.content);

            if (token) {
              subscriber.next({
                data: JSON.stringify({
                  type: 'chunk',
                  content: token,
                } as StreamPayload),
              });
            }
          }

          // 5. Emit Done Event
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
   * Prepares system prompt and RAG context according to classified intent
   */
  private async prepareContext(
    tenantId: string,
    userMessage: string,
    intentResult: IntentResult,
  ): Promise<{
    systemContext: string;
    suggestedProducts?: ScoredProduct[];
    metadata?: Record<string, any>;
  }> {
    const { intent, extracted_query } = intentResult;

    switch (intent) {
      case IntentType.QUERY_PRODUCT: {
        const searchQuery = extracted_query || userMessage;
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

        return {
          systemContext,
          suggestedProducts: products,
          metadata: { searchQuery, matchedCount: products.length },
        };
      }

      case IntentType.CHECK_ORDER: {
        const systemContext = `You are an E-Commerce Order Support Assistant.
The customer is inquiring about the status of an order.
If they provided an order ID (like "${extracted_query || ''}"), acknowledge it warmly and let them know you are checking the latest shipping and delivery updates.
If no order ID was provided, politely ask them for their order number or the email address used during purchase.
Keep the tone reassuring and concise.`;

        return {
          systemContext,
          metadata: { orderId: extracted_query },
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
}
