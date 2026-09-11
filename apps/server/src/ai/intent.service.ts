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

      return this.parseIntentResponse(content);
    } catch (error) {
      this.logger.warn(
        `Intent classification LLM call issue for input "${userInput}": ${error.message}. Defaulting to UNKNOWN intent.`,
      );
      return {
        intent: IntentType.UNKNOWN,
        confidence: 0.0,
        extracted_query: null,
      };
    }
  }

  private parseIntentResponse(rawResponse: string): IntentResult {
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
        : IntentType.UNKNOWN;

      const confidence =
        typeof parsed.confidence === 'number'
          ? Math.min(Math.max(parsed.confidence, 0), 1)
          : 0.5;

      const extracted_query =
        parsed.extracted_query && typeof parsed.extracted_query === 'string'
          ? parsed.extracted_query.trim()
          : null;

      return {
        intent,
        confidence,
        extracted_query,
      };
    } catch (parseError) {
      this.logger.warn(`Failed to parse LLM intent JSON output: "${rawResponse}". Falling back to UNKNOWN.`);
      return {
        intent: IntentType.UNKNOWN,
        confidence: 0.0,
        extracted_query: null,
      };
    }
  }
}
