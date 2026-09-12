# Omnichannel Commerce AI — Project Flow & System Architecture

This document provides a comprehensive, end-to-end technical reference and lifecycle flow diagram for the **Omnichannel Commerce AI Engine**.

---

## 1. High-Level Architecture Overview

```mermaid
flowchart TD
    subgraph ClientLayer ["Client & Channel Layer"]
        Widget["Next.js Embeddable Chat Widget<br/>(Tailwind CSS + EventSource SSE)"]
        Channels["Omnichannel Messaging APIs<br/>(Web / Mobile / Webhook)"]
    end

    subgraph APILayer ["NestJS API & Orchestrator (apps/server)"]
        ChatController["ChatController<br/>POST /api/chat/message<br/>GET /api/chat/stream (SSE)"]
        ChatService["ChatService Orchestrator<br/>(5-Stage Trace Pipeline)"]
        IntentService["IntentService<br/>(Fast Regex Heuristics + LLM Fallback)"]
        VectorService["VectorSearchService<br/>(pgvector Cosine Sim >= 0.3)"]
        StoreProvider["IStoreProvider<br/>(DatabaseStoreProvider / Shopify / Mock)"]
        LlmService["LlmService Circuit Breaker<br/>(Gemini Primary + Groq Fallback Chain)"]
    end

    subgraph DataLayer ["Data & Caching Layer"]
        Redis["Redis (In-Memory)<br/>- Chat History LRANGE<br/>- Pub/Sub & BullMQ Queue"]
        Postgres["PostgreSQL + pgvector<br/>- Tenants, Conversations, Messages<br/>- Products (384-d Embeddings)<br/>- Orders & Timeline Steps"]
    end

    subgraph WorkerLayer ["Asynchronous Queue Workers"]
        BullMQ["BullMQ: 'chat-persistence' Queue"]
        Worker["ChatPersistenceProcessor Worker<br/>(Async PostgreSQL Batch Insert)"]
    end

    Widget -->|HTTP / SSE| ChatController
    Channels -->|HTTP / SSE| ChatController
    ChatController --> ChatService

    ChatService -->|Stage 1: Intent| IntentService
    ChatService -->|Stage 2: Semantic RAG| VectorService
    ChatService -->|Stage 2: Store / Order Lookup| StoreProvider
    ChatService -->|Stage 3: Memory Fast-Read| Redis
    ChatService -->|Stage 4: Synthesis & Stream| LlmService
    ChatService -->|Stage 5: Async Persistence Job| BullMQ

    BullMQ --> Worker
    Worker -->|Non-blocking write| Postgres
    VectorService --> Postgres
    StoreProvider --> Postgres
```

---

## 2. End-to-End User Text Lifecycle (5-Stage Trace Pipeline)

Every incoming customer message passes through 5 distinct pipeline stages:

```mermaid
sequenceDiagram
    autonumber
    actor Customer as User / Web Widget
    participant Server as ChatService (apps/server)
    participant Intent as IntentService
    participant Store as Vector / StoreProvider
    participant Redis as Redis Memory
    participant LLM as LlmService (Circuit Breaker)
    participant BullMQ as BullMQ 'chat-persistence'
    participant DB as PostgreSQL (pgvector)

    Customer->>Server: [TRACE 1/5] Send userMessage ("Do you have blue running shoes?")
    
    par Parallel Pre-execution
        Server->>Intent: Classify Intent
        Intent-->>Server: [TRACE 2/5] Intent=QUERY_PRODUCT (96%), extracted_query="blue running shoes"
        Server->>Store: Vector Similarity Search (pgvector)
        Store-->>Server: Top-K Scored Products (Cosine similarity >= 0.3)
        Server->>Redis: LRANGE chat:history:{tenantId}:{convId} (0 to -1)
        Redis-->>Server: Recent conversation turns
    end

    Server->>Store: [TRACE 3/5] Store Query: Product search string="blue running shoes"
    Store-->>Server: Product catalog items

    Server->>Server: [TRACE 4/5] Injected System Prompt compilation (Grounded context + Multilingual rules)
    
    Server->>LLM: Invoke / Stream Active Runnable (LangChain History)
    LLM-->>Server: [TRACE 5/5] Final AI Reply generated
    
    par Response Return & Async Decoupled Persistence
        Server-->>Customer: Immediate Response / SSE Token Stream (Zero DB latency)
        Server->>BullMQ: Enqueue 'save-history' job (Non-blocking)
    end

    BullMQ->>DB: Worker persists User & Assistant messages to PostgreSQL
```

### Trace Logging Specification

| Stage Marker | Component | Description |
| :--- | :--- | :--- |
| `[TRACE: 1/5]` | `ChatService.processMessage` | Exact incoming raw `userMessage`, `tenantId`, and `conversationId`. |
| `[TRACE: 2/5]` | `IntentService.classifyIntent` | Detected `intent`, `confidence`, and `extracted_query`. |
| `[TRACE: 3/5]` | `ChatService.prepareContext` | Exact search string or order lookup identifier dispatched to store provider. |
| `[TRACE: 4/5]` | `ChatService.prepareContext` | Full compiled system prompt bracketed between `--- SYSTEM PROMPT START ---` and `--- SYSTEM PROMPT END ---`. |
| `[TRACE: 5/5]` | `ChatService` | Final generated AI response string before enqueuing persistence. |

---

## 3. Resilient LLM Circuit Breaker & Fallback Chain

`LlmService` features an **In-Memory Circuit Breaker Pattern** with **Half-Open Auto-Recovery** to prevent latency spikes during Gemini rate-limiting (`429` / `RESOURCE_EXHAUSTED`):

```mermaid
stateDiagram-v2
    [*] --> CLOSED: Initial Bootstrap

    state CLOSED {
        [*] --> GeminiPrimary: Normal Traffic
        GeminiPrimary --> GeminiSuccess: 200 OK
    }

    CLOSED --> OPEN: Gemini throws 429 / RESOURCE_EXHAUSTED / Quota exceeded
    note right of OPEN
        Circuit Breaker TRIP
        - isPrimaryDisabled = true
        - primaryDisabledUntil = Date.now() + 10m
        - Immediate bypass of Gemini
        - Latency drops to < 1.1s (Groq direct)
    end note

    state OPEN {
        [*] --> GroqFallbackChain: Direct Routing
        GroqFallbackChain --> Groq1: Groq Llama-3.3-70b-versatile
        Groq1 --> Groq2: Fallback Llama-3.1-8b-instant
        Groq2 --> Groq3: Safety OpenAI GPT-OSS-20b
    }

    OPEN --> HALF_OPEN: 10-minute cooldown expires (primaryDisabledUntil passed)
    note right of HALF_OPEN
        Circuit Breaker HALF-OPEN
        - isPrimaryDisabled = false
        - Next request probes Gemini
    end note

    state HALF_OPEN {
        [*] --> ProbeGemini: Probe Request
    }

    HALF_OPEN --> CLOSED: Probe request succeeds (RESET)
    HALF_OPEN --> OPEN: Probe request hits 429 again (Re-trip for 10m)
```

### Model Hierarchy

```
Primary:
└── ChatGoogleGenerativeAI (gemini-3.6-flash, temperature: 0.3)
    │
    ▼ (On 429 or Failover)
Fallback Chain:
├── ChatGroq (llama-3.3-70b-versatile, temperature: 0.3)
├── ChatGroq (llama-3.1-8b-instant, temperature: 0.3)
└── ChatGroq (openai/gpt-oss-20b, temperature: 0.3)
```

---

## 4. Intent Classification Engine

`IntentService` applies a two-tier classification architecture:

1. **Sub-millisecond Heuristic Fast-Path (`< 1ms`)**:
   - `GREETING`: Regex matches multilingual salutations (English, Burmese `မင်္ဂလာပါ`, Thai `สวัสดี`, `thx`, etc.).
   - `CHECK_ORDER`: Regex pattern matching tracking keywords and order IDs (`#ORD-12345`, `[0-9]{4,8}`).
   - `ADD_TO_CART`: Regex patterns matching checkout and bag keywords (`add ... to cart`, `buy ...`).
   - `QUERY_PRODUCT`: Common commerce keywords (`shoes`, `sneakers`, `hoodie`, `price of ...`).

2. **LLM Structured JSON Fallback (`~200-400ms`)**:
   - For ambiguous queries, invokes LLM with strict JSON schema output:
   ```json
   {
     "intent": "QUERY_PRODUCT",
     "confidence": 0.96,
     "extracted_query": "running shoes or headphones"
   }
   ```

---

## 5. Semantic Vector RAG & Store Catalog Integration

```mermaid
flowchart LR
    UserInput["User Query"] --> Embedder["EmbeddingsService<br/>(Xenova/all-MiniLM-L6-v2)"]
    Embedder -->|384-dimensional Float32 Array| Vector["Vector Representation"]
    Vector --> Query["PostgreSQL pgvector Query<br/>SELECT id, name, price, 1 - (embedding <=> $1) AS similarity"]
    Query --> Filter["Threshold Filter: similarity >= 0.3<br/>LIMIT 4"]
    Filter --> CatalogPrompt["Grounded Store Catalog Prompt Block"]
```

---

## 6. Multi-Turn Conversation Memory Architecture

```mermaid
flowchart TD
    subgraph ReadPath ["Fast-Path Read (Zero DB Blocking)"]
        Req["Incoming Request"] --> RedisRead["RedisChatMessageHistory<br/>LRANGE chat:history:{tenantId}:{convId}"]
        RedisRead --> RunnableChain["RunnableWithMessageHistory<br/>(Injects {chat_history} to Prompt)"]
    end

    subgraph WritePath ["Decoupled Async Persistence (BullMQ)"]
        RunnableChain --> ResponseDone["Response Generated"]
        ResponseDone --> Enqueue["BullMQ Queue: 'chat-persistence'<br/>Job: 'save-history'"]
        Enqueue --> ClientReturn["Return Response to Customer<br/>(Immediate ~0ms DB overhead)"]
        Enqueue -.-> BullMQWorker["ChatPersistenceProcessor"]
        BullMQWorker --> PGInsert["PostgreSQL INSERT INTO messages<br/>(USER & ASSISTANT records)"]
    end
```

---

## 7. Multilingual Grounding System

The assistant dynamically adapts tone, vocabulary, and polite particles while maintaining exact product IDs, numeric prices, and attributes:

- **English**: Natural, concise, friendly commerce assistant.
- **Burmese (မြန်မာဘာသာ)**: Natural Burmese with polite particles (`ခင်ဗျာ` / `ရှင့်`).
- **Thai (ภาษาไทย)**: Polite Thai with standard conversational particles (`ค่ะ` / `ครับ`).

---

## 8. Database Schema Overview (`PostgreSQL + pgvector`)

```mermaid
erDiagram
    TENANTS ||--o{ CONVERSATIONS : "owns"
    TENANTS ||--o{ PRODUCTS : "catalogs"
    TENANTS ||--o{ ORDERS : "manages"
    CONVERSATIONS ||--o{ MESSAGES : "contains"
    ORDERS ||--o{ ORDER_STATUS_STEPS : "tracks"

    TENANTS {
        string id PK
        string name
        string api_key UK
        datetime created_at
    }

    CONVERSATIONS {
        string id PK
        string tenant_id FK
        string external_user_id
        datetime created_at
    }

    MESSAGES {
        string id PK
        string conversation_id FK
        enum sender_type "USER | ASSISTANT | SYSTEM"
        text content
        vector vector_embedding "vector(384)"
        jsonb metadata
        datetime created_at
    }

    PRODUCTS {
        string id PK
        string tenant_id FK
        string name
        text description
        decimal price
        string category
        boolean in_stock
        jsonb attributes
        vector embedding "vector(384)"
    }

    ORDERS {
        string id PK
        string tenant_id FK
        string order_number UK
        string customer_email
        decimal total_amount
        string status
    }

    ORDER_STATUS_STEPS {
        string id PK
        string order_id FK
        string title
        string timestamp_str
        string status "completed | current | pending"
        string icon
        int step_index
    }
```

---

## 9. API Reference & Verification Commands

### Endpoints

| Method | Path | Description |
| :--- | :--- | :--- |
| `POST` | `/api/chat/message` | Synchronous chat endpoint returning structured `ChatResponse`. |
| `GET` | `/api/chat/stream` | Server-Sent Events (SSE) token stream with metadata events. |
| `GET` | `/api/chat/history` | Retrieves stored conversation history for a tenant and conversation. |

### Verification & Test Suite Commands

```bash
# Run Circuit Breaker State Machine Unit Tests
npm run test:circuit

# Run Fast-Failover Latency Benchmark (Groq Direct when Circuit OPEN)
npm run test:failover

# Run Full End-to-End Chat Benchmark (BullMQ Decoupled Persistence)
npm run test:chat:benchmark

# Run Intent Classifier Tests
npm run test:intent

# Run Vector Search Similarity Tests
npm run test:vector
```
