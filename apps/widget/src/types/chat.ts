export interface ProductData {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  category?: string | null;
  inStock?: boolean;
  attributes?: Record<string, any>;
  image?: string;
}

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
}

export interface OrderSummaryData {
  orderNumber: string;
  status: 'accepted' | 'rejected' | 'pending' | 'processing';
  customerName?: string;
  shippingAddress?: string;
  items: OrderItem[];
  totalAmount: number;
  orderDate?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp?: string;
  products?: ProductData[];
  orderSummary?: OrderSummaryData;
}
