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

export interface OrderTimelineStep {
  title: string;
  timestamp: string;
  status: 'completed' | 'current' | 'pending';
  icon?: 'check' | 'truck' | 'home' | 'package';
}

export interface OrderTimelineData {
  orderNumber: string;
  steps: OrderTimelineStep[];
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp?: string;
  products?: ProductData[];
  orderTimeline?: OrderTimelineData;
}
