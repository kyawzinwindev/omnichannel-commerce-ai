export interface ProductSearchFilters {
  brand?: string | null;
  targetGender?: string | null;
  categoryType?: string | null;
}

export interface ProductItem {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  brand?: string | null;
  targetGender?: string | null;
  category?: string | null;
  stock?: number;
  inStock: boolean;
  colors?: string[];
  sizes?: string[];
  image?: string | null;
  attributes?: Record<string, any> | null;
  similarity?: number;
  rrfScore?: number;
}

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
  color?: string | null;
  size?: string | null;
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
  getProductList(
    tenantId: string,
    query?: string,
    limit?: number,
    filters?: ProductSearchFilters,
  ): Promise<ProductItem[]>;
  getOrderSummary(tenantId: string, orderNumber: string): Promise<OrderSummaryResult | null>;
}

export const STORE_PROVIDER = Symbol('STORE_PROVIDER');
