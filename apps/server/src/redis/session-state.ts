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
  /** When true, the Telegram pipeline bypasses the LLM and a human admin replies. */
  isHumanMode?: boolean;
  /** Last meaningful (non chit-chat) intent, used to re-anchor the conversation. */
  lastAction?: string;
  /** Last product the customer was exploring. */
  lastViewedProduct?: { id?: string; name: string };
  /** Truncated last assistant reply, for context when the user drifts off-topic. */
  lastBotMessage?: string;
  lastUpdated?: number;
}
