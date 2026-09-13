import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from './llm.service';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatStage, DraftOrder } from '../redis/session-state';

export enum IntentType {
  GREETING = 'GREETING',
  QUERY_PRODUCT = 'QUERY_PRODUCT',
  GENERAL_CATALOG_QUERY = 'GENERAL_CATALOG_QUERY',
  CHECK_ORDER = 'CHECK_ORDER',
  ADD_TO_CART = 'ADD_TO_CART',
  COLLECT_INFO = 'COLLECT_INFO',
  CONFIRM_ORDER = 'CONFIRM_ORDER',
  CANCEL_ORDER = 'CANCEL_ORDER',
  UNKNOWN = 'UNKNOWN',
}

export interface ExtractedInfo {
  name?: string;
  phone?: string;
  address?: string;
  quantity?: number;
}

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  extracted_query: string | null;
  extracted_info?: ExtractedInfo;
}

@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);

  constructor(private readonly llmService: LlmService) {}

  /**
   * Fast rule-based heuristic classifier for high-frequency commerce patterns (< 1ms)
   */
  private matchFastRules(input: string, currentStage: ChatStage = ChatStage.IDLE): IntentResult | null {
    const text = input.trim();
    const lower = text.toLowerCase();

    // 1. CANCEL_ORDER Fast Path
    if (
      /^(cancel|cancel\s+order|stop|abort|reset|nevermind|clear|မလုပ်တော့ပါ|ဖျက်သိမ်း|ยกเลิก)[\s!.,?]*$/i.test(
        lower,
      )
    ) {
      return {
        intent: IntentType.CANCEL_ORDER,
        confidence: 0.99,
        extracted_query: null,
      };
    }

    // 2. CONFIRM_ORDER Fast Path (Prioritized in CONFIRMING_ORDER stage)
    if (
      /^(yes|confirm|proceed|place\s+order|looks\s+good|correct|agree|ok|okay|sure|yep|yup|ဟုတ်ကဲ့|အတည်ပြုပါ|ใช่|ยืนยัน)[\s!.,?]*$/i.test(
        lower,
      )
    ) {
      return {
        intent: IntentType.CONFIRM_ORDER,
        confidence: 0.99,
        extracted_query: null,
      };
    }

    // 3. GENERAL_CATALOG_QUERY Fast Path
    const generalCatalogRegex =
      /^(?:what\s+(?:products|items|things|goods)\s+do\s+you\s+(?:sell|have)|what\s+do\s+you\s+(?:sell|have)|show\s+(?:all\s+|me\s+)?(?:products|items|catalog)|list\s+(?:all\s+)?(?:products|items)|view\s+catalog|browse\s+(?:store|catalog)|what\'s\s+in\s+store|catalog)[?!.]*$/i;
    if (generalCatalogRegex.test(lower)) {
      return {
        intent: IntentType.GENERAL_CATALOG_QUERY,
        confidence: 0.99,
        extracted_query: null,
      };
    }

    // 4. GREETING Fast Path
    const greetingRegex =
      /^(hi|hello|hey|good\s+(morning|afternoon|evening|day)|howdy|greetings|mingalaba|မင်္ဂလာပါ|sawasdee|สวัสดี|thanks|thank\s+you|thx|ကျေးဇူး|ขอบคุณ)[\s!.,?]*$/i;
    if (greetingRegex.test(lower) && currentStage === ChatStage.IDLE) {
      return {
        intent: IntentType.GREETING,
        confidence: 0.99,
        extracted_query: null,
      };
    }

    // 5. CHECK_ORDER Fast Path
    const orderMatch =
      text.match(
        /(?:where is|check|status of|track|find)?\s*(?:my\s+)?order\s*(?:#|number|id)?\s*([A-Za-z0-9_-]{4,15})/i,
      ) || text.match(/#?([0-9]{4,8})/);
    if (
      /(order|tracking|shipment|delivery|parcel|package|status)/i.test(lower) &&
      orderMatch &&
      currentStage === ChatStage.IDLE
    ) {
      return {
        intent: IntentType.CHECK_ORDER,
        confidence: 0.98,
        extracted_query: orderMatch[1] || orderMatch[0],
      };
    }

    // 6. ADD_TO_CART Fast Path
    const cartMatch =
      text.match(
        /(?:please\s+)?(?:add|put)\s+(?:the\s+|this\s+)?(.+?)\s+to\s+(?:my\s+)?(?:shopping\s+)?cart/i,
      ) || text.match(/(?:please\s+)?(?:buy|purchase|checkout)\s+(?:the\s+|this\s+)?(.+)/i);
    if (cartMatch && cartMatch[1]) {
      return {
        intent: IntentType.ADD_TO_CART,
        confidence: 0.99,
        extracted_query: cartMatch[1].trim(),
      };
    }

    // 7. COLLECT_INFO Heuristics during COLLECTING_USER_INFO stage
    if (currentStage === ChatStage.COLLECTING_USER_INFO) {
      const phoneRegex = /(\+?[0-9\s-]{7,15})/;
      const phoneMatch = text.match(phoneRegex);
      const isLikelyInfo =
        phoneMatch ||
        /(name is|my name|i am|address|street|st|ave|rd|road|lane|city|state|zip|yangon|mandalay|bangkok|live at|deliver to)/i.test(
          lower,
        );

      if (isLikelyInfo) {
        return null; // Delegate to LLM for precise structured entity extraction
      }
    }

    // 8. Specific Product Query Fast Path
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

    return null;
  }

  /**
   * Classifies user input into one of the predefined commerce intent categories with stage awareness.
   */
  async classifyIntent(
    userInput: string,
    currentStage: ChatStage = ChatStage.IDLE,
    draftOrder?: DraftOrder,
  ): Promise<IntentResult> {
    if (!userInput || !userInput.trim()) {
      return {
        intent: IntentType.UNKNOWN,
        confidence: 1.0,
        extracted_query: null,
      };
    }

    // 1. Fast-Path Rule Evaluation (< 1ms)
    const fastResult = this.matchFastRules(userInput, currentStage);
    if (fastResult) {
      this.logger.debug(
        `Fast-path intent matched: ${fastResult.intent} (Confidence: ${fastResult.confidence})`,
      );
      return fastResult;
    }

    // 2. Fallback to LLM Classification for contextual & entity-rich inputs
    const draftStatus = draftOrder
      ? `Name: ${draftOrder.name || 'MISSING'}, Phone: ${draftOrder.phone || 'MISSING'}, Address: ${draftOrder.address || 'MISSING'}`
      : 'No draft order data';

    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are a high-precision Intent Classification Engine for an E-Commerce AI Assistant.
Current Chat Stage: {currentStage}
Current Draft Order Context: {draftStatus}

Classify the customer's message into EXACTLY ONE of the following intents:

1. GREETING: Customer says hello, hi, good morning, thanks, or pleasantries.
2. GENERAL_CATALOG_QUERY: Customer asks general questions about store inventory without a specific product name (e.g., "what products do you sell?", "show all items", "what do you have?"). You MUST set "extracted_query" to null for this intent to avoid false database queries!
3. QUERY_PRODUCT: Customer is searching for, asking about, or inquiring about a specific product, item, brand, or feature. Extract the search term into "extracted_query".
4. CHECK_ORDER: Customer is asking for order tracking or status of an existing order.
5. ADD_TO_CART: Customer wants to add an item to their cart, buy, purchase, or order an item. Extract item name to "extracted_query", quantity into "extracted_info.quantity" if mentioned (default 1).
6. COLLECT_INFO: When current stage is COLLECTING_USER_INFO (or customer is providing their name, phone number, or shipping address). Extract any detected entities into "extracted_info" (name, phone, address).
7. CONFIRM_ORDER: Customer agrees, confirms, approves, or says 'Yes' to finalize the order (e.g., "yes", "confirm", "proceed", "looks good", "place order").
8. CANCEL_ORDER: Customer wants to cancel, reset, or abort the order process.
9. UNKNOWN: Out of scope or gibberish.

CRITICAL INSTRUCTIONS:
- Return ONLY valid, raw JSON. No markdown backticks or commentary outside JSON.
- If intent is GENERAL_CATALOG_QUERY, "extracted_query" MUST be null.

Expected JSON schema:
{{
  "intent": "GREETING" | "GENERAL_CATALOG_QUERY" | "QUERY_PRODUCT" | "CHECK_ORDER" | "ADD_TO_CART" | "COLLECT_INFO" | "CONFIRM_ORDER" | "CANCEL_ORDER" | "UNKNOWN",
  "confidence": 0.95,
  "extracted_query": "specific product name / order id / or null",
  "extracted_info": {{
    "name": "Customer Name or null",
    "phone": "Phone number or null",
    "address": "Shipping address or null",
    "quantity": 1
  }}
}}`,
      ],
      ['user', '{input}'],
    ]);

    try {
      const formatted = await prompt.formatMessages({
        currentStage,
        draftStatus,
        input: userInput,
      });
      const response = await this.llmService.getModel().invoke(formatted);

      const content =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      return this.parseIntentResponse(content, userInput);
    } catch (error) {
      this.logger.warn(
        `Intent classification LLM call issue for input "${userInput}": ${error.message}. Defaulting to QUERY_PRODUCT fallback.`,
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

      let extracted_query =
        parsed.extracted_query && typeof parsed.extracted_query === 'string'
          ? parsed.extracted_query.trim()
          : null;

      if (intent === IntentType.GENERAL_CATALOG_QUERY) {
        extracted_query = null;
      } else if (!extracted_query && intent === IntentType.QUERY_PRODUCT) {
        extracted_query = userInput?.trim() || null;
      }

      const extracted_info: ExtractedInfo = {};
      if (parsed.extracted_info && typeof parsed.extracted_info === 'object') {
        if (parsed.extracted_info.name && typeof parsed.extracted_info.name === 'string') {
          extracted_info.name = parsed.extracted_info.name.trim();
        }
        if (parsed.extracted_info.phone && typeof parsed.extracted_info.phone === 'string') {
          extracted_info.phone = parsed.extracted_info.phone.trim();
        }
        if (parsed.extracted_info.address && typeof parsed.extracted_info.address === 'string') {
          extracted_info.address = parsed.extracted_info.address.trim();
        }
        if (typeof parsed.extracted_info.quantity === 'number') {
          extracted_info.quantity = parsed.extracted_info.quantity;
        }
      }

      return {
        intent,
        confidence,
        extracted_query,
        extracted_info: Object.keys(extracted_info).length > 0 ? extracted_info : undefined,
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
