const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const TOKEN_KEY = 'omnichannel_admin_token';

export type SenderType = 'USER' | 'ASSISTANT' | 'AGENT' | 'SYSTEM';

export interface Product {
  id: string;
  name: string;
  brand: string | null;
  targetGender: 'MEN' | 'WOMEN' | 'UNISEX' | null;
  categoryType: string | null;
  price: number;
  description: string | null;
  stock: number;
  inStock: boolean;
}

export interface ProductsResponse {
  data: Product[];
  meta: PageMeta;
  filters: { brands: string[]; categoryTypes: string[]; genders: string[] };
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  customer: { name: string | null; phone: string | null; email: string | null; shippingAddress: string | null };
  itemsSummary: string;
  items: { id: string; name: string; quantity: number; price: number }[];
}

export interface Conversation {
  id: string;
  customerName: string | null;
  username: string | null;
  isHumanMode: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderType: SenderType;
  content: string;
  createdAt: string;
}

export type LiveEvent =
  | { type: 'message'; conversation: Conversation; message: ChatMessage }
  | { type: 'mode'; conversationId: string; isHumanMode: boolean }
  | { type: 'ping' };

export const auth = {
  get token() {
    return localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
  },
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401 && !path.includes('/auth/login')) {
    auth.clear();
    onUnauthorized();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new ApiError(res.status, message ?? res.statusText);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const qs = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && q.set(k, String(v)));
  return q.toString();
};

export const api = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; user: { email: string; role: string } }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  products: (p: { page: number; pageSize: number; brand?: string; gender?: string; categoryType?: string; search?: string }) =>
    request<ProductsResponse>(`/api/v1/admin/products?${qs(p)}`),
  orders: (p: { page: number; pageSize: number; status?: string; search?: string }) =>
    request<{ data: Order[]; meta: PageMeta }>(`/api/v1/admin/orders?${qs(p)}`),
  conversations: () => request<{ data: Conversation[] }>('/api/v1/admin/conversations'),
  messages: (chatId: string) => request<{ data: ChatMessage[] }>(`/api/v1/admin/conversations/${chatId}/messages`),
  markRead: (chatId: string) => request<void>(`/api/v1/admin/conversations/${chatId}/read`, { method: 'POST' }),
  toggleMode: (chatId: string, isHumanMode?: boolean) =>
    request<{ data: Conversation }>(`/api/v1/admin/conversations/${chatId}/toggle-mode`, {
      method: 'PATCH',
      body: JSON.stringify(isHumanMode === undefined ? {} : { isHumanMode }),
    }),
  reply: (chatId: string, text: string) =>
    request<{ data: ChatMessage }>(`/api/v1/admin/conversations/${chatId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
};

/** Opens the live SSE stream; EventSource can't send headers so the JWT goes in the query string. */
export function openLiveStream(onEvent: (e: LiveEvent) => void, onStatus: (connected: boolean) => void) {
  const source = new EventSource(`${API_URL}/api/v1/admin/conversations/stream?token=${auth.token ?? ''}`);
  source.onopen = () => onStatus(true);
  source.onerror = () => onStatus(false);
  source.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data) as LiveEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  return () => source.close();
}
