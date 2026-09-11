import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from './llm.service';
import { ChatPromptTemplate } from '@langchain/core/prompts';

export enum IntentType {
  GREETING = 'GREETING',
  QUERY_PRODUCT = 'QUERY_PRODUCT',
  CHECK_ORDER = 'CHECK_ORDER',
  ADD_TO_CART = 'ADD_TO_CART',
  UNKNOWN = 'UNKNOWN',
}

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  extracted_query: string | null;
}

@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);

  constructor(private readonly llmService: LlmService) { }

  /**
   * Fast rule-based heuristic classifier for high-frequency commerce patterns (runs in < 1ms)
   */
  private matchFastRules(input: string): IntentResult | null {
    const text = input.trim();
    const lower = text.toLowerCase();

    // 1. GREETING Fast Path
    const greetingRegex =
      /^(hi|hello|hey|good\s+(morning|afternoon|evening|day)|howdy|greetings|mingalaba|မင်္ဂလာပါ|sawasdee|สวัสดี|thanks|thank\s+you|thx|ကျေးဇူး|ခอบคุณ)[\s!.,?]*$/i;
    if (greetingRegex.test(lower)) {
      return {
        intent: IntentType.GREETING,
        confidence: 0.99,
        extracted_query: null,
      };
    }

    // 2. CHECK_ORDER Fast Path
    const orderMatch =
      text.match(/(?:where is|check|status of|track|find)?\s*(?:my\s+)?order\s*(?:#|number|id)?\s*([A-Za-z0-9_-]{4,15})/i) ||
      text.match(/#?([0-9]{4,8})/);
    if (
      /(order|tracking|shipment|delivery|parcel|package|status)/i.test(lower) &&
      orderMatch
    ) {
      return {
        intent: IntentType.CHECK_ORDER,
        confidence: 0.98,
        extracted_query: orderMatch[1] || orderMatch[0],
      };
    }

    // 3. ADD_TO_CART Fast Path
    const cartMatch =
      text.match(/(?:please\s+)?(?:add|put)\s+(?:the\s+|this\s+)?(.+?)\s+to\s+(?:my\s+)?(?:shopping\s+)?cart/i) ||
      text.match(/(?:please\s+)?(?:buy|purchase|checkout)\s+(?:the\s+|this\s+)?(.+)/i);
    if (cartMatch && cartMatch[1]) {
      return {
        intent: IntentType.ADD_TO_CART,
        confidence: 0.99,
        extracted_query: cartMatch[1].trim(),
      };
    }

    // 4. QUERY_PRODUCT Fast Path
    const productQueryPatterns = [
      /^(?:do you have|can you show me|show me|find|search for|looking for|recommend|what kind of)\s+(.+?)[?!.]*$/i,
      /^(?:how much is|price of|what is the price of)\s+(.+?)[?!.]*$/i,
      /^(?:is there any|any)\s+(.+?)[?!.]*$/i,
    ];

    for (const pattern of productQueryPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const query = match[1]
          .replace(/\b(available|in stock|under \$\d+|in [a-zA-Z]+ size)\b/gi, '')
          .trim();
        return {
          intent: IntentType.QUERY_PRODUCT,
          confidence: 0.96,
          extracted_query: query || match[1].trim(),
        };
      }
    }

    // Check keywords for common commerce items
    if (
      /\b(shoes?|sneakers?|boots?|shirt|t-shirt|hoodie|jacket|pants|jeans|headphones?|earbuds?|watch|bag|backpack|dress|socks?)\b/i.test(
        lower,
      ) &&
      !/(order|shipping|track|cancel|refund)/i.test(lower)
    ) {
      return {
        intent: IntentType.QUERY_PRODUCT,
        confidence: 0.94,
        extracted_query: text.replace(/[?!.]/g, '').trim(),
      };
    }

    return null;
  }

  /**
   * Classifies user input into one of the predefined commerce intent categories.
   * Returns a structured JSON result: { intent, confidence, extracted_query }
   */
  async classifyIntent(userInput: string): Promise<IntentResult> {
    if (!userInput || !userInput.trim()) {
      return {
        intent: IntentType.UNKNOWN,
        confidence: 1.0,
        extracted_query: null,
      };
    }

    // 1. Fast-Path Rule Evaluation (< 1ms)
    const fastResult = this.matchFastRules(userInput);
    if (fastResult) {
      this.logger.debug(
        `Fast-path intent matched: ${fastResult.intent} (Confidence: ${fastResult.confidence})`,
      );
      return fastResult;
    }

    // 2. Fallback to LLM Classification for complex / ambiguous inputs
    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are a high-precision Intent Classification Engine for an E-Commerce AI Assistant.
Your task is to analyze the customer's input and classify it into EXACTLY ONE of the following intents:

1. GREETING: Customer is saying hello, hi, good morning, thanks, or general pleasantries without specific product or order queries.
2. QUERY_PRODUCT: Customer is looking for, asking about, searching for, or inquiring about products, items, inventory, specifications, or recommendations.
3. CHECK_ORDER: Customer is asking for order status, shipment tracking, delivery updates, order numbers, return/refund status of an existing order.
4. ADD_TO_CART: Customer explicitly requests to add an item to their cart, buy, purchase, or checkout a specific product.
5. UNKNOWN: The input is unclear, gibberish, out of context, or doesn't match the commerce scope.

Extract relevant key terms into "extracted_query" (e.g. the product name, category, keywords, or order number). If not applicable, set it to null.
Provide a "confidence" score between 0.00 and 1.00.

CRITICAL INSTRUCTION:
You MUST respond with VALID, RAW JSON ONLY. Do not include markdown code blocks, backticks, or any conversational text outside the JSON.

Expected JSON schema:
{{
  "intent": "GREETING" | "QUERY_PRODUCT" | "CHECK_ORDER" | "ADD_TO_CART" | "UNKNOWN",
  "confidence": 0.95,
  "extracted_query": "search keyword or order id or null"
}}`,
      ],
      ['user', '{input}'],
    ]);

    try {
      const formatted = await prompt.formatMessages({ input: userInput });
      const response = await this.llmService.getModel().invoke(formatted);

      const content =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      return this.parseIntentResponse(content, userInput);
    } catch (error) {
      this.logger.warn(
        `Intent classification LLM call issue for input "${userInput}": ${error.message}. Gracefully defaulting to QUERY_PRODUCT fallback.`,
      );
      return {
        intent: IntentType.QUERY_PRODUCT,
        confidence: 0.5,
        extracted_query: userInput.trim(),
      };
    }
  }

  private parseIntentResponse(rawResponse: string, userInput?: string): IntentResult {
    try {
      // Remove any unexpected markdown code fence wrap if present
      const cleaned = rawResponse
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      const validIntents = Object.values(IntentType);
      const intent = validIntents.includes(parsed.intent)
        ? (parsed.intent as IntentType)
        : IntentType.QUERY_PRODUCT;

      const confidence =
        typeof parsed.confidence === 'number'
          ? Math.min(Math.max(parsed.confidence, 0), 1)
          : 0.5;

      const extracted_query =
        parsed.extracted_query && typeof parsed.extracted_query === 'string'
          ? parsed.extracted_query.trim()
          : userInput?.trim() || null;

      return {
        intent,
        confidence,
        extracted_query,
      };
    } catch (parseError) {
      this.logger.warn(
        `Failed to parse LLM intent JSON output: "${rawResponse}". Falling back to QUERY_PRODUCT.`,
      );
      return {
        intent: IntentType.QUERY_PRODUCT,
        confidence: 0.5,
        extracted_query: userInput?.trim() || null,
      };
    }
  }
}
