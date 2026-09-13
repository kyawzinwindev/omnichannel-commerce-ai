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

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
}

export interface OrderSummaryResult {
  orderNumber: string;
  status: 'accepted' | 'rejected' | 'pending' | 'processing';
  customerName?: string;
  shippingAddress?: string;
  items: OrderItem[];
  totalAmount: number;
  orderDate?: string;
}

export interface IStoreProvider {
  getProductList(tenantId: string, query?: string, limit?: number): Promise<ProductItem[]>;
  getOrderSummary(tenantId: string, orderNumber: string): Promise<OrderSummaryResult | null>;
}

export const STORE_PROVIDER = Symbol('STORE_PROVIDER');
