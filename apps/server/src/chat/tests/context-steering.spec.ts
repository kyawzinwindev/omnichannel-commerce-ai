// @nestjs/bullmq is ESM-only and irrelevant here; stub the decorator so ChatService loads under CJS Jest.
jest.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => () => undefined,
}));

import { ChatService } from '../chat.service';
import { IntentContext, IntentService, IntentType } from '../intent.service';
import { ENGLISH_ONLY_INSTRUCTION } from '../language-policy';
import { buildStageAwareSystemPrompt } from '../chat-response.prompt';
import { RedisService } from '../../redis/redis.service';
import { ChatStage, UserSessionState } from '../../redis/session-state';

/**
 * Context-Aware Steering tests.
 *
 * The Groq models are mocked so the suite is deterministic:
 *  - intent model (gpt-oss-20b): returns scripted JSON, records the prompt it received
 *  - response model (gpt-oss-120b): records the system prompt it received and returns a canned reply
 *
 * Because the response LLM is mocked, assertions verify the *instructions and context* handed to
 * the generator (stage, last action, last product, missing fields, re-anchoring rule) and that the
 * Redis session state survives the drift. Set RUN_LIVE_LLM=1 with GROQ_API_KEY to also run the
 * live reply assertions at the bottom of this file.
 */

const TENANT = 'tenant-1';
const CONV = 'conv-1';

const BURMESE_OR_THAI = /[\u1000-\u109F\u0E00-\u0E7F]/;

function makeSession(overrides: Partial<UserSessionState> = {}): UserSessionState {
  return { stage: ChatStage.IDLE, cart: [], draftOrder: {}, ...overrides };
}

interface Harness {
  chat: ChatService;
  intentPrompts: string[];
  systemPrompts: string[];
  intentLlmCalls: () => number;
  store: Map<string, string>;
  savedSession: () => UserSessionState | null;
}

function createHarness(
  session: UserSessionState,
  intentScript: (input: string) => Record<string, any> = () => ({
    intent: 'CHIT_CHAT',
    confidence: 0.9,
    extracted_query: null,
  }),
): Harness {
  const store = new Map<string, string>();
  const key = `${TENANT}:${CONV}`;
  store.set(key, JSON.stringify(session));

  const redis: any = {
    getSessionState: jest.fn(async () => {
      const raw = store.get(key);
      return raw ? JSON.parse(raw) : makeSession();
    }),
    setSessionState: jest.fn(async (_t: string, _c: string, s: UserSessionState) => {
      store.set(key, JSON.stringify(s));
    }),
    clearSessionState: jest.fn(async () => {
      store.delete(key);
    }),
  };

  const intentPrompts: string[] = [];
  let intentCalls = 0;
  const llm: any = {
    getIntentModel: () => ({
      invoke: async (messages: any[]) => {
        intentCalls++;
        intentPrompts.push(messages.map((m) => String(m.content)).join('\n'));
        const userInput = String(messages[messages.length - 1].content);
        return { content: JSON.stringify(intentScript(userInput)) };
      },
    }),
    getResponseModel: () => ({}),
  };

  const storeProvider: any = {
    getProductList: jest.fn(async () => []),
    getOrderSummary: jest.fn(async () => null),
  };
  const queue: any = { add: jest.fn(async () => ({ id: 'job-1' })) };

  const intentService = new IntentService(llm);
  const chat = new ChatService(
    intentService,
    storeProvider,
    llm,
    {} as any,
    { create: jest.fn() } as any,
    redis,
    queue,
  );

  // Replace the LangChain history chain with a recorder of the system prompt.
  const systemPrompts: string[] = [];
  (chat as any).createHistoryRunnable = () => ({
    invoke: async ({ systemContext }: { systemContext: string; input: string }) => {
      systemPrompts.push(systemContext);
      return { content: 'Mock assistant reply.' };
    },
  });

  return {
    chat,
    intentPrompts,
    systemPrompts,
    intentLlmCalls: () => intentCalls,
    store,
    savedSession: () => {
      const raw = store.get(key);
      return raw ? (JSON.parse(raw) as UserSessionState) : null;
    },
  };
}

describe('Context-Aware Steering', () => {
  describe('English-only enforcement', () => {
    it('adds the English-only instruction to every response-prompt stage', () => {
      const sessions: UserSessionState[] = [
        makeSession(),
        makeSession({ stage: ChatStage.COLLECTING_USER_INFO, draftOrder: { name: 'Alex' } }),
        makeSession({
          stage: ChatStage.CONFIRMING_ORDER,
          cart: [{ productId: 'p1', name: 'Shorts', price: 10, quantity: 1 }],
          draftOrder: { name: 'Alex', phone: '0912345678', address: '1 Main St' },
        }),
      ];
      for (const session of sessions) {
        for (const intent of [IntentType.CHIT_CHAT, IntentType.UNKNOWN, IntentType.GREETING]) {
          const prompt = buildStageAwareSystemPrompt({ intent, session });
          expect(prompt).toContain(ENGLISH_ONLY_INSTRUCTION);
          expect(prompt).toContain('Do NOT output Burmese (Myanmar) or Thai');
          expect(prompt).not.toMatch(BURMESE_OR_THAI);
        }
      }
    });

    it('adds the English-only instruction to the intent (gpt-oss-20b) prompt', async () => {
      const h = createHarness(makeSession());
      await h.chat.processMessage(TENANT, 'It is raining heavily outside', CONV);
      expect(h.intentPrompts).toHaveLength(1);
      expect(h.intentPrompts[0]).toContain(ENGLISH_ONLY_INSTRUCTION);
    });
  });

  describe('Pure-LLM intent pipeline (no keyword fast-paths)', () => {
    const ctx = (over: Partial<IntentContext> = {}): IntentContext => ({
      currentState: ChatStage.IDLE,
      ...over,
    });

    /** Intent model that records every call and replies with a scripted JSON payload. */
    function scriptedService(reply: Record<string, any> | string) {
      const calls: string[] = [];
      const svc = new IntentService({
        getIntentModel: () => ({
          invoke: async (messages: any[]) => {
            calls.push(messages.map((m) => String(m.content)).join('\n'));
            return { content: typeof reply === 'string' ? reply : JSON.stringify(reply) };
          },
        }),
      } as any);
      return { svc, calls };
    }

    it('has no legacy fast-path helpers', () => {
      expect((IntentService.prototype as any).matchFastRules).toBeUndefined();
    });

    it.each(['yes', 'hi', 'lol', 'wait a sec', 'cancel', '0912345678'])(
      'sends "%s" to the LLM instead of intercepting it',
      async (text) => {
        const { svc, calls } = scriptedService({ intent: 'CHIT_CHAT', confidence: 0.9 });
        const result = await svc.classifyIntent(text, ctx());
        expect(calls).toHaveLength(1);
        expect(result.intent).toBe(IntentType.CHIT_CHAT);
      },
    );

    it('injects currentState, lastBotMessage, pendingContext and the raw message', async () => {
      const { svc, calls } = scriptedService({ intent: 'CONFIRM_ORDER', confidence: 0.97 });
      await svc.classifyIntent('looks fine', {
        currentState: ChatStage.COLLECTING_USER_INFO,
        lastBotMessage: 'What is your shipping address?',
        cart: [{ productId: 'p1', name: 'Nike Shorts', price: 30, quantity: 2 }],
        draftOrder: { name: 'Alex', phone: '0912345678' },
        lastViewedProduct: { name: 'Nike Shorts' },
      });
      const prompt = calls[0];
      expect(prompt).toContain('currentState: COLLECTING_USER_INFO');
      expect(prompt).toContain('lastBotMessage: What is your shipping address?');
      expect(prompt).toContain('Cart: 2x Nike Shorts');
      expect(prompt).toContain('address=MISSING');
      expect(prompt).toContain('Missing checkout fields: address');
      expect(prompt).toContain('Product being viewed: Nike Shorts');
      expect(prompt).toContain('looks fine');
      expect(prompt).toContain('dialogue state reasoning engine');
      expect(prompt).toContain('"reasoning"');
      expect(prompt).toContain('"extractedEntities"');
      expect(prompt).toContain('CONFIRMING_ORDER context');
      expect(prompt).toContain('COLLECTING_USER_INFO context');
      expect(prompt).toContain(ENGLISH_ONLY_INSTRUCTION);
    });

    it('parses reasoning, intent and extractedEntities', async () => {
      const { svc } = scriptedService({
        reasoning: 'The bot asked for contact details and the user gave a phone number.',
        intent: 'COLLECT_INFO',
        confidence: 0.95,
        extractedEntities: { product: null, quantity: null, name: null, phone: '0912345678', address: null },
      });
      const result = await svc.classifyIntent('0912345678', ctx({ currentState: ChatStage.COLLECTING_USER_INFO }));
      expect(result.intent).toBe(IntentType.COLLECT_INFO);
      expect(result.reasoning).toContain('phone number');
      expect(result.extracted_info).toEqual({ phone: '0912345678' });
      expect(result.extracted_query).toBeNull();
    });

    it('maps extractedEntities.product / quantity for ADD_TO_CART', async () => {
      const { svc } = scriptedService({
        intent: 'ADD_TO_CART',
        confidence: 0.9,
        extractedEntities: { product: 'Adidas Joggers', quantity: 2 },
      });
      const result = await svc.classifyIntent('two of those joggers please', ctx());
      expect(result.extracted_query).toBe('Adidas Joggers');
      expect(result.extracted_info?.quantity).toBe(2);
    });

    it('resolves to UNKNOWN (state preserved) when the LLM fails or returns bad JSON', async () => {
      const bad = scriptedService('not json at all');
      expect((await bad.svc.classifyIntent('hello', ctx())).intent).toBe(IntentType.UNKNOWN);

      const failing = new IntentService({
        getIntentModel: () => ({
          invoke: async () => {
            throw new Error('groq down');
          },
        }),
      } as any);
      expect((await failing.classifyIntent('hello', ctx())).intent).toBe(IntentType.UNKNOWN);
    });

    describe('end-to-end with LLM-resolved intents', () => {
      const confirming = () =>
        makeSession({
          stage: ChatStage.CONFIRMING_ORDER,
          cart: [{ productId: 'nike-1', name: 'Nike Shorts', price: 30, quantity: 2 }],
          draftOrder: { name: 'Alex', phone: '0912345678', address: '12 Baker Street' },
          lastBotMessage: "Reply 'Yes' to confirm your order.",
        });

      it('places the order when the LLM resolves an affirmation to CONFIRM_ORDER', async () => {
        const h = createHarness(confirming(), () => ({ intent: 'CONFIRM_ORDER', confidence: 0.97 }));
        const res = await h.chat.processMessage(TENANT, 'sounds good, go for it', CONV);
        expect(h.intentLlmCalls()).toBe(1);
        expect(res.intent).toBe(IntentType.CONFIRM_ORDER);
        expect((h.chat as any).ordersService.create).toHaveBeenCalledTimes(1);
      });

      it('cancels and resets when the LLM resolves a rejection to CANCEL_ORDER', async () => {
        const h = createHarness(confirming(), () => ({ intent: 'CANCEL_ORDER', confidence: 0.97 }));
        const res = await h.chat.processMessage(TENANT, 'nah forget it', CONV);
        expect(res.intent).toBe(IntentType.CANCEL_ORDER);
        expect((h.chat as any).ordersService.create).not.toHaveBeenCalled();
        expect(h.savedSession()).toBeNull();
      });

      it('does not place an order when the LLM resolves "yes" as chit-chat in IDLE', async () => {
        const h = createHarness(makeSession(), () => ({ intent: 'CHIT_CHAT', confidence: 0.8 }));
        const res = await h.chat.processMessage(TENANT, 'yes', CONV);
        expect(res.intent).toBe(IntentType.CHIT_CHAT);
        expect((h.chat as any).ordersService.create).not.toHaveBeenCalled();
      });

      it('hands the session context to the classifier prompt', async () => {
        const h = createHarness(confirming(), () => ({ intent: 'CONFIRM_ORDER', confidence: 0.9 }));
        await h.chat.processMessage(TENANT, 'ok', CONV);
        expect(h.intentPrompts[0]).toContain('currentState: CONFIRMING_ORDER');
        expect(h.intentPrompts[0]).toContain("lastBotMessage: Reply 'Yes' to confirm your order.");
        expect(h.intentPrompts[0]).toContain('Cart: 2x Nike Shorts');
      });
    });
  });

  describe('Scenario 1: Product discovery steering', () => {
    const browsing = () =>
      makeSession({
        lastAction: IntentType.QUERY_PRODUCT,
        lastViewedProduct: { id: 'adidas-1', name: "Adidas Men's Joggers" },
        lastBotMessage: "Adidas Men's Joggers - $45 (In Stock). How many would you like?",
      });

    it.each(['ummm', 'wait a sec', 'idk', 'It is raining heavily outside', "I'm hungry"])(
      're-anchors to the Adidas item for "%s" and keeps session state',
      async (text) => {
        const h = createHarness(browsing());
        const res = await h.chat.processMessage(TENANT, text, CONV);

        expect([IntentType.CHIT_CHAT, IntentType.UNKNOWN]).toContain(res.intent);

        const prompt = h.systemPrompts[0];
        expect(prompt).toContain('CONVERSATION STEERING');
        expect(prompt).toContain("Adidas Men's Joggers");
        expect(prompt).toContain('Do NOT reset the product search');
        expect(prompt).toMatch(/sizes, colours/i);
        expect(prompt).toContain('Acknowledge the customer');
        expect(prompt).toContain('ALWAYS end by re-anchoring');
        expect(prompt).toContain('Last action: QUERY_PRODUCT');

        const saved = h.savedSession();
        expect(saved).not.toBeNull();
        expect(saved!.lastViewedProduct?.name).toBe("Adidas Men's Joggers");
        expect(saved!.lastAction).toBe(IntentType.QUERY_PRODUCT); // chit-chat never overwrites anchor
        expect(saved!.lastBotMessage).toBe('Mock assistant reply.');
      },
    );

    it('does not run a product search for the drifting message', async () => {
      const h = createHarness(browsing());
      await h.chat.processMessage(TENANT, "I'm hungry", CONV);
      expect((h.chat as any).storeProvider.getProductList).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 2: Cart selection steering', () => {
    const picked = () =>
      makeSession({
        lastAction: IntentType.ADD_TO_CART,
        lastViewedProduct: { id: 'nike-1', name: "Nike Women's Running Shorts" },
      });

    it.each(['tell me a joke', "lol that's cool"])(
      'asks for quantity after "%s"',
      async (text) => {
        const h = createHarness(picked());
        await h.chat.processMessage(TENANT, text, CONV);

        const prompt = h.systemPrompts[0];
        expect(prompt).toContain("Nike Women's Running Shorts");
        expect(prompt).toMatch(/ask how many they want/i);
        expect(prompt).toMatch(/how many .*Nike Women's Running Shorts.* would you like to add to your cart/i);

        const saved = h.savedSession();
        expect(saved!.lastViewedProduct?.name).toBe("Nike Women's Running Shorts");
        expect(saved!.lastAction).toBe(IntentType.ADD_TO_CART);
      },
    );
  });

  describe('Scenario 3: Information collection steering', () => {
    const collecting = () =>
      makeSession({
        stage: ChatStage.COLLECTING_USER_INFO,
        cart: [{ productId: 'nike-1', name: "Nike Women's Running Shorts", price: 30, quantity: 2 }],
        draftOrder: { name: 'Alex', phone: '0912345678' },
      });

    it.each(['Where is your shop located?', 'What time do you close?'])(
      'prompts for the missing address after "%s"',
      async (text) => {
        const h = createHarness(collecting());
        await h.chat.processMessage(TENANT, text, CONV);

        const prompt = h.systemPrompts[0];
        expect(prompt).toContain('Missing required fields: Shipping Address');
        expect(prompt).toContain('Already collected: Name: Alex, Phone: 0912345678');
        expect(prompt).toContain('CONVERSATION STEERING');
        expect(prompt).toContain('state clearly which specific field is still missing: Shipping Address');
        expect(prompt).not.toMatch(/Missing required fields:[^\n]*Full Name/);

        const saved = h.savedSession()!;
        expect(saved.stage).toBe(ChatStage.COLLECTING_USER_INFO);
        expect(saved.draftOrder).toEqual({ name: 'Alex', phone: '0912345678' });
        expect(saved.cart).toHaveLength(1);
      },
    );
  });

  describe('Scenario 4: Order confirmation steering', () => {
    const confirming = () =>
      makeSession({
        stage: ChatStage.CONFIRMING_ORDER,
        cart: [{ productId: 'nike-1', name: "Nike Women's Running Shorts", price: 30, quantity: 2 }],
        draftOrder: { name: 'Alex', phone: '0912345678', address: '12 Baker Street' },
      });

    it.each([
      ['crypto is booming', 'CHIT_CHAT'],
      ['random text 123', 'UNKNOWN'],
    ])('re-anchors to the pending order after "%s" (%s)', async (text, intent) => {
      const h = createHarness(confirming(), () => ({ intent, confidence: 0.6, extracted_query: null }));
      const res = await h.chat.processMessage(TENANT, text, CONV);

      expect(res.intent).toBe(intent);
      const prompt = h.systemPrompts[0];
      expect(prompt).toContain('ORDER CONFIRMATION STAGE');
      expect(prompt).toContain("Reply 'Yes' to confirm");
      expect(prompt).toMatch(/edit anything/i);
      expect(prompt).toContain('proceed with the order confirmation or make changes');
      expect(prompt).toContain('ONE friendly sentence');
      expect(prompt).toContain('IMMEDIATELY steer them back');
      expect(prompt).toContain('The order has NOT been placed yet');
      expect(prompt).toContain('Pending cart: 2x Nike Women\'s Running Shorts');

      const saved = h.savedSession()!;
      expect(saved.stage).toBe(ChatStage.CONFIRMING_ORDER);
      expect(saved.draftOrder.address).toBe('12 Baker Street');
    });

    it('does not place the order on unrelated chatter', async () => {
      const h = createHarness(confirming());
      await h.chat.processMessage(TENANT, 'crypto is booming', CONV);
      expect((h.chat as any).ordersService.create).not.toHaveBeenCalled();
    });
  });

  describe('Redis session hydration', () => {
    it('round-trips lastAction / lastViewedProduct / lastBotMessage', async () => {
      const svc: any = Object.create(RedisService.prototype);
      svc.logger = { warn: jest.fn() };
      svc.get = async () =>
        JSON.stringify({
          stage: 'IDLE',
          cart: [],
          draftOrder: {},
          lastAction: 'QUERY_PRODUCT',
          lastViewedProduct: { id: 'a', name: "Adidas Men's Joggers" },
          lastBotMessage: 'hello',
        });
      const state = await svc.getSessionState(TENANT, CONV);
      expect(state.lastAction).toBe('QUERY_PRODUCT');
      expect(state.lastViewedProduct.name).toBe("Adidas Men's Joggers");
      expect(state.lastBotMessage).toBe('hello');
    });
  });

  describe('Scenario 5: Apparel Variant Slot-Filling (color, size, quantity)', () => {
    const cargoPantsProduct = {
      id: 'nike-men-pants-4',
      name: "Nike Men's Cargo Pants",
      price: 68.0,
      stock: 40,
      inStock: true,
      colors: ['Black', 'Olive', 'Red', 'Sand'],
      sizes: ['S', 'M', 'L', 'XL'],
    };

    it('1. Partial request ("I want cargo pants") stays in SELECTING_VARIANT and asks for color, size, and quantity', async () => {
      const h = createHarness(makeSession(), () => ({
        intent: 'ADD_TO_CART',
        confidence: 0.96,
        extractedEntities: { product: 'cargo pants', color: null, size: null, quantity: null },
      }));
      (h.chat as any).storeProvider.getProductList = jest.fn(async () => [cargoPantsProduct]);

      await h.chat.processMessage(TENANT, 'I want cargo pants', CONV);

      const saved = h.savedSession()!;
      expect(saved.stage).toBe(ChatStage.SELECTING_VARIANT);
      expect(saved.cart).toHaveLength(0);
      expect(saved.pendingItem).toEqual(
        expect.objectContaining({
          productId: 'nike-men-pants-4',
          productName: "Nike Men's Cargo Pants",
          availableColors: ['Black', 'Olive', 'Red', 'Sand'],
          availableSizes: ['S', 'M', 'L', 'XL'],
          selectedColor: null,
          selectedSize: null,
          quantity: null,
        }),
      );

      const prompt = h.systemPrompts[0];
      expect(prompt).toContain('VARIANT SELECTION (SLOT-FILLING) STAGE');
      expect(prompt).toContain("Nike Men's Cargo Pants");
      expect(prompt).toContain('Available Colors: Black, Olive, Red, Sand');
      expect(prompt).toContain('Available Sizes: S, M, L, XL');
      expect(prompt).toContain('Missing Required Slots: color, size, quantity');
      expect(prompt).toContain('Do NOT ask for the customer\'s name, phone number, or shipping address yet');
    });

    it('2. Multi-turn slot filling ("cargo pants" -> "Red, size L" -> "3 pieces") adds item to cart and transitions to COLLECTING_USER_INFO', async () => {
      const scripts: Record<string, any>[] = [
        {
          intent: 'ADD_TO_CART',
          confidence: 0.96,
          extractedEntities: { product: 'cargo pants', color: null, size: null, quantity: null },
        },
        {
          intent: 'ADD_TO_CART',
          confidence: 0.96,
          extractedEntities: { product: null, color: 'Red', size: 'L', quantity: null },
        },
        {
          intent: 'ADD_TO_CART',
          confidence: 0.96,
          extractedEntities: { product: null, color: null, size: null, quantity: 3 },
        },
      ];
      let turn = 0;
      const h = createHarness(makeSession(), () => scripts[turn++]);
      (h.chat as any).storeProvider.getProductList = jest.fn(async () => [cargoPantsProduct]);

      // Turn 1: "I want cargo pants"
      await h.chat.processMessage(TENANT, 'I want cargo pants', CONV);
      expect(h.savedSession()!.stage).toBe(ChatStage.SELECTING_VARIANT);

      // Turn 2: "Red, size L" -> still missing quantity
      await h.chat.processMessage(TENANT, 'Red, size L', CONV);
      const afterTurn2 = h.savedSession()!;
      expect(afterTurn2.stage).toBe(ChatStage.SELECTING_VARIANT);
      expect(afterTurn2.pendingItem?.selectedColor).toBe('Red');
      expect(afterTurn2.pendingItem?.selectedSize).toBe('L');
      expect(afterTurn2.pendingItem?.quantity).toBeNull();
      expect(h.systemPrompts[1]).toContain('Missing Required Slots: quantity');

      // Turn 3: "3 pieces" -> completes pendingItem, pushes to cart, transitions to COLLECTING_USER_INFO
      await h.chat.processMessage(TENANT, '3 pieces', CONV);
      const afterTurn3 = h.savedSession()!;
      expect(afterTurn3.stage).toBe(ChatStage.COLLECTING_USER_INFO);
      expect(afterTurn3.pendingItem).toBeUndefined();
      expect(afterTurn3.cart).toEqual([
        {
          productId: 'nike-men-pants-4',
          name: "Nike Men's Cargo Pants",
          price: 68.0,
          quantity: 3,
          color: 'Red',
          size: 'L',
        },
      ]);
      expect(h.systemPrompts[2]).toContain('COLLECTING USER INFO STAGE');
      expect(h.systemPrompts[2]).toContain("3x Nike Men's Cargo Pants (Red, Size L)");
    });

    it('3. Complete single-turn request ("3 red cargo pants size L") skips slot questions and moves straight to COLLECTING_USER_INFO', async () => {
      const h = createHarness(makeSession(), () => ({
        intent: 'ADD_TO_CART',
        confidence: 0.98,
        extractedEntities: { product: 'cargo pants', color: 'Red', size: 'L', quantity: 3 },
      }));
      (h.chat as any).storeProvider.getProductList = jest.fn(async () => [cargoPantsProduct]);

      await h.chat.processMessage(TENANT, 'I want 3 red cargo pants in size L', CONV);

      const saved = h.savedSession()!;
      expect(saved.stage).toBe(ChatStage.COLLECTING_USER_INFO);
      expect(saved.pendingItem).toBeUndefined();
      expect(saved.cart).toEqual([
        {
          productId: 'nike-men-pants-4',
          name: "Nike Men's Cargo Pants",
          price: 68.0,
          quantity: 3,
          color: 'Red',
          size: 'L',
        },
      ]);
      expect(h.systemPrompts[0]).toContain('COLLECTING USER INFO STAGE');
      expect(h.systemPrompts[0]).toContain('Missing required fields: Full Name, Phone Number, Shipping Address');
    });

    it('4. Context drift while selecting size/color steers user back to finish choosing options', async () => {
      const selecting = makeSession({
        stage: ChatStage.SELECTING_VARIANT,
        lastAction: IntentType.ADD_TO_CART,
        lastViewedProduct: { id: 'nike-men-pants-4', name: "Nike Men's Cargo Pants" },
        lastBotMessage: 'Which size (S, M, L, XL) and quantity would you like?',
        pendingItem: {
          productId: 'nike-men-pants-4',
          productName: "Nike Men's Cargo Pants",
          price: 68.0,
          availableColors: ['Black', 'Olive', 'Red', 'Sand'],
          availableSizes: ['S', 'M', 'L', 'XL'],
          selectedColor: 'Red',
          selectedSize: null,
          quantity: null,
        },
      });

      const h = createHarness(selecting, () => ({ intent: 'CHIT_CHAT', confidence: 0.92 }));
      await h.chat.processMessage(TENANT, 'tell me a joke', CONV);

      const saved = h.savedSession()!;
      expect(saved.stage).toBe(ChatStage.SELECTING_VARIANT);
      expect(saved.pendingItem?.selectedColor).toBe('Red');

      const prompt = h.systemPrompts[0];
      expect(prompt).toContain('VARIANT SELECTION (SLOT-FILLING) STAGE');
      expect(prompt).toContain('CONVERSATION STEERING');
      expect(prompt).toContain('Still needed: size, quantity');
      expect(prompt).toContain('Available sizes: S, M, L, XL');
    });
  });
});

/**
 * Optional live check against real Groq endpoints.
 * Run with: RUN_LIVE_LLM=1 GROQ_API_KEY=... npx jest src/chat/tests/context-steering.spec.ts
 */
const live = process.env.RUN_LIVE_LLM === '1' && process.env.GROQ_API_KEY ? describe : describe.skip;

live('Context-Aware Steering (live Groq)', () => {
  it('re-anchors to the Adidas item in English', async () => {
    const { ChatGroq } = await import('@langchain/groq');
    const model = new ChatGroq({
      apiKey: process.env.GROQ_API_KEY,
      model: 'openai/gpt-oss-120b',
      temperature: 0.2,
    });
    const system = buildStageAwareSystemPrompt({
      intent: IntentType.CHIT_CHAT,
      session: makeSession(),
      lastAction: IntentType.QUERY_PRODUCT,
      lastViewedProduct: { name: "Adidas Men's Joggers" },
    });
    const res = await model.invoke([
      ['system', system],
      ['human', "I'm hungry"],
    ]);
    const text = String(res.content);
    expect(text).not.toMatch(BURMESE_OR_THAI);
    expect(text).toMatch(/adidas|joggers|size|colou?r/i);
  }, 30000);
});
