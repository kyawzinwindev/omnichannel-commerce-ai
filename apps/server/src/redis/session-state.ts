export enum ChatStage {
  IDLE = 'IDLE',
  COLLECTING_USER_INFO = 'COLLECTING_USER_INFO',
  CONFIRMING_ORDER = 'CONFIRMING_ORDER',
}

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface DraftOrder {
  name?: string;
  phone?: string;
  address?: string;
}

export interface UserSessionState {
  stage: ChatStage;
  cart: CartItem[];
  draftOrder: DraftOrder;
  lastUpdated?: number;
}
