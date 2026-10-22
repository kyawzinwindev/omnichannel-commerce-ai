// @nestjs/bullmq is ESM-only and irrelevant here; stub the decorator so ChatService loads under CJS Jest.
jest.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => () => undefined,
}));

import { ChatService } from '../chat.service';
import { IntentService, IntentType } from '../intent.service';
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

  describe('Intent fast-path for English fillers', () => {
    const intentService = new IntentService({ getIntentModel: () => ({ invoke: jest.fn() }) } as any);

    it.each(['ummm', 'wait a sec', 'idk', 'hmm', 'lol', 'uhh...'])(
      '"%s" is CHIT_CHAT without calling the LLM',
      async (text) => {
        const result = await intentService.classifyIntent(text, ChatStage.IDLE);
        expect(result.intent).toBe(IntentType.CHIT_CHAT);
        expect(result.extracted_query).toBeNull();
      },
    );

    it('treats a bare "ok" as filler outside CONFIRMING_ORDER', async () => {
      const result = await intentService.classifyIntent('ok', ChatStage.COLLECTING_USER_INFO);
      expect(result.intent).toBe(IntentType.CHIT_CHAT);
    });

    it('treats "ok" as confirmation inside CONFIRMING_ORDER', async () => {
      const result = await intentService.classifyIntent('ok', ChatStage.CONFIRMING_ORDER);
      expect(result.intent).toBe(IntentType.CONFIRM_ORDER);
    });

    it('does not treat fillers as a cancel/reset', async () => {
      const result = await intentService.classifyIntent('wait', ChatStage.CONFIRMING_ORDER);
      expect(result.intent).not.toBe(IntentType.CANCEL_ORDER);
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
