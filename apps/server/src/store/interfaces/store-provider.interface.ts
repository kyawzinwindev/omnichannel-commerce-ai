export interface ProductItem {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  category?: string | null;
  inStock: boolean;
  image?: string | null;
  attributes?: Record<string, any> | null;
  similarity?: number;
}

export interface OrderTimelineStepItem {
  title: string;
  timestamp: string;
  status: 'completed' | 'current' | 'pending';
  icon?: 'check' | 'truck' | 'home' | 'package';
}

export interface OrderTimelineResult {
  orderNumber: string;
  status: string;
  customerEmail?: string | null;
  totalAmount?: number;
  steps: OrderTimelineStepItem[];
}

export interface IStoreProvider {
  getProductList(tenantId: string, query?: string, limit?: number): Promise<ProductItem[]>;
  getOrderTimeline(tenantId: string, orderNumber: string): Promise<OrderTimelineResult | null>;
}

export const STORE_PROVIDER = Symbol('STORE_PROVIDER');
