import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from './llm.service';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { CartItem, ChatStage, DraftOrder } from '../redis/session-state';
import { ENGLISH_ONLY_INSTRUCTION } from './language-policy';

export enum IntentType {
  GREETING = 'GREETING',
  QUERY_PRODUCT = 'QUERY_PRODUCT',
  GENERAL_CATALOG_QUERY = 'GENERAL_CATALOG_QUERY',
  CHECK_ORDER = 'CHECK_ORDER',
  ADD_TO_CART = 'ADD_TO_CART',
  COLLECT_INFO = 'COLLECT_INFO',
  CONFIRM_ORDER = 'CONFIRM_ORDER',
  CANCEL_ORDER = 'CANCEL_ORDER',
  CHIT_CHAT = 'CHIT_CHAT',
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
  /** Product name / order id extracted from `extractedEntities.product`. */
  extracted_query: string | null;
  extracted_info?: ExtractedInfo;
  /** The model's step-by-step contextual evaluation (for logging / debugging). */
  reasoning?: string;
}

/** Dialogue context handed to the classifier alongside the raw user message. */
export interface IntentContext {
  currentState: ChatStage;
  lastBotMessage?: string | null;
  cart?: CartItem[];
  draftOrder?: DraftOrder;
  lastViewedProduct?: { id?: string; name: string } | null;
  lastAction?: string | null;
}

/**
 * Purely LLM-driven intent classification (openai/gpt-oss-20b).
 * There are NO keyword / regex fast-paths: every message is reasoned about against the
 * active dialogue state, the last bot message and the pending checkout context.
 */
@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);

  constructor(private readonly llmService: LlmService) {}

  /** Describes what the bot is currently waiting on (cart, missing fields, product in view). */
  private buildPendingContext(ctx: IntentContext): string {
    const parts: string[] = [];
    const cart = ctx.cart ?? [];
    parts.push(
      cart.length > 0
        ? `Cart: ${cart.map((c) => `${c.quantity}x ${c.name}`).join(', ')}`
        : 'Cart: empty',
    );

    const draft = ctx.draftOrder ?? {};
    const missing = (['name', 'phone', 'address'] as const).filter((k) => !draft[k]);
    parts.push(
      `Customer details: name=${draft.name || 'MISSING'}, phone=${draft.phone || 'MISSING'}, address=${draft.address || 'MISSING'}`,
    );
    if (ctx.currentState === ChatStage.COLLECTING_USER_INFO) {
      parts.push(`Missing checkout fields: ${missing.join(', ') || 'none'}`);
    }
    if (ctx.lastViewedProduct?.name) parts.push(`Product being viewed: ${ctx.lastViewedProduct.name}`);
    if (ctx.lastAction) parts.push(`Last meaningful action: ${ctx.lastAction}`);
    return parts.join('\n');
  }

  /**
   * Classifies the user message with the LLM, grounded in the active session state.
   * On any failure resolves to UNKNOWN so the session state is preserved (never a destructive intent).
   */
  async classifyIntent(userInput: string, context: IntentContext): Promise<IntentResult> {
    if (!userInput || !userInput.trim()) {
      return { intent: IntentType.UNKNOWN, confidence: 1.0, extracted_query: null };
    }

    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are the dialogue state reasoning engine for an e-commerce assistant.
You must analyze the user's intent by interpreting their message in the context of currentState and lastBotMessage.

currentState: {currentState}
lastBotMessage: {lastBotMessage}
pendingContext:
{pendingContext}

INTENTS (choose EXACTLY ONE):
- GREETING: hello, hi, thanks or other pleasantries.
- GENERAL_CATALOG_QUERY: broad question about what the store sells, with no specific product (extractedEntities.product MUST be null).
- QUERY_PRODUCT: asking about a specific product, brand or feature (put the search term in extractedEntities.product).
- CHECK_ORDER: asking for tracking/status of an existing order (put the order id in extractedEntities.product).
- ADD_TO_CART: wants to buy / add an item (product in extractedEntities.product, quantity in extractedEntities.quantity, default 1).
- COLLECT_INFO: providing name, phone number or delivery address.
- CONFIRM_ORDER: agrees to finalize the pending order.
- CANCEL_ORDER: wants to abort / cancel the order process.
- CHIT_CHAT: banter, jokes, small talk, fragments or fillers with no bearing on the current dialogue.
- UNKNOWN: out of scope or gibberish.

CONTEXT EVALUATION RULES:
1. CONFIRMING_ORDER context:
   - Any agreement, approval or positive affirmation ("yes", "okay", "sure", "go ahead", "proceed", "looks fine") means the user agrees to finalize -> CONFIRM_ORDER.
   - Any rejection or stopping phrase ("no", "cancel", "don't", "wait stop") means abort -> CANCEL_ORDER.
   - Do NOT treat affirmations as casual chit-chat when an order confirmation prompt is active.
2. COLLECTING_USER_INFO context:
   - If the user provides information intended to fulfil the missing checkout requirements (names, phone numbers, delivery addresses) -> COLLECT_INFO, and fill the matching extractedEntities fields.
3. Disruption / off-topic in active states (CONFIRMING_ORDER, COLLECTING_USER_INFO, or product browsing):
   - If the user asks something completely unrelated, banters, tells a joke, or sends fragmented fillers -> CHIT_CHAT or UNKNOWN.
   - Preserve the active state so the response generator can steer the conversation back.
4. Outside CONFIRMING_ORDER, a bare "yes"/"okay" does not confirm anything; interpret it against lastBotMessage (e.g. answering a question the bot asked) or treat it as CHIT_CHAT.
5. Only choose CONFIRM_ORDER when currentState is CONFIRMING_ORDER.

OUTPUT RULES:
- Return ONLY valid raw JSON. No markdown backticks or commentary.
- {englishOnly}
- Write "reasoning" FIRST (step by step: what does the user mean specifically within the active dialogue state?), then decide "intent".
- Use null for entities that are not present.

JSON schema:
{{
  "reasoning": "Step-by-step contextual evaluation of the user message within the active dialogue state",
  "intent": "GREETING" | "GENERAL_CATALOG_QUERY" | "QUERY_PRODUCT" | "CHECK_ORDER" | "ADD_TO_CART" | "COLLECT_INFO" | "CONFIRM_ORDER" | "CANCEL_ORDER" | "CHIT_CHAT" | "UNKNOWN",
  "confidence": 0.95,
  "extractedEntities": {{
    "product": null,
    "quantity": null,
    "name": null,
    "phone": null,
    "address": null
  }}
}}`,
      ],
      ['user', '{userMessage}'],
    ]);

    try {
      const formatted = await prompt.formatMessages({
        currentState: context.currentState,
        lastBotMessage: context.lastBotMessage || 'None',
        pendingContext: this.buildPendingContext(context),
        englishOnly: ENGLISH_ONLY_INSTRUCTION,
        userMessage: userInput,
      });
      const response = await this.llmService.getIntentModel().invoke(formatted);

      const content =
        typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

      return this.parseIntentResponse(content, userInput);
    } catch (error) {
      this.logger.warn(
        `Intent classification LLM call failed for input "${userInput}": ${error.message}. Resolving to UNKNOWN (state preserved).`,
      );
      return { intent: IntentType.UNKNOWN, confidence: 0.0, extracted_query: null };
    }
  }

  private asTrimmedString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private parseIntentResponse(rawResponse: string, userInput?: string): IntentResult {
    try {
      const cleaned = rawResponse
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      const intent = Object.values(IntentType).includes(parsed.intent)
        ? (parsed.intent as IntentType)
        : IntentType.UNKNOWN;

      const confidence =
        typeof parsed.confidence === 'number' ? Math.min(Math.max(parsed.confidence, 0), 1) : 0.5;

      const entities =
        parsed.extractedEntities && typeof parsed.extractedEntities === 'object'
          ? parsed.extractedEntities
          : {};

      let extracted_query: string | null = this.asTrimmedString(entities.product) ?? null;
      if (intent === IntentType.GENERAL_CATALOG_QUERY) {
        extracted_query = null;
      } else if (!extracted_query && intent === IntentType.QUERY_PRODUCT) {
        extracted_query = userInput?.trim() || null;
      }

      const extracted_info: ExtractedInfo = {};
      const name = this.asTrimmedString(entities.name);
      const phone = this.asTrimmedString(entities.phone);
      const address = this.asTrimmedString(entities.address);
      if (name) extracted_info.name = name;
      if (phone) extracted_info.phone = phone;
      if (address) extracted_info.address = address;
      if (typeof entities.quantity === 'number') extracted_info.quantity = entities.quantity;

      return {
        intent,
        confidence,
        extracted_query,
        extracted_info: Object.keys(extracted_info).length > 0 ? extracted_info : undefined,
        reasoning: this.asTrimmedString(parsed.reasoning),
      };
    } catch {
      this.logger.warn(
        `Failed to parse LLM intent JSON output: "${rawResponse}". Resolving to UNKNOWN (state preserved).`,
      );
      return { intent: IntentType.UNKNOWN, confidence: 0.0, extracted_query: null };
    }
  }
}
