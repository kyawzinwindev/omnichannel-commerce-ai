export enum ChatStage {
  IDLE = 'IDLE',
  /** Slot-filling: a product was chosen, waiting for color / size / quantity. */
  SELECTING_VARIANT = 'SELECTING_VARIANT',
  COLLECTING_USER_INFO = 'COLLECTING_USER_INFO',
  CONFIRMING_ORDER = 'CONFIRMING_ORDER',
}

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  color?: string | null;
  size?: string | null;
}

/** Item being configured before it is added to the cart. */
export interface PendingItem {
  productId: string;
  productName: string;
  price: number;
  stock?: number;
  availableColors: string[];
  availableSizes: string[];
  selectedColor?: string | null;
  selectedSize?: string | null;
  quantity?: number | null;
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
  /** Product currently going through color / size / quantity slot-filling. */
  pendingItem?: PendingItem;
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

/** Slots still required before the pending item can go into the cart. */
export function missingSlots(p: PendingItem): Array<'color' | 'size' | 'quantity'> {
  const missing: Array<'color' | 'size' | 'quantity'> = [];
  if (p.availableColors.length > 0 && !p.selectedColor) missing.push('color');
  if (p.availableSizes.length > 0 && !p.selectedSize) missing.push('size');
  if (!p.quantity) missing.push('quantity');
  return missing;
}

/** "Red / L" style label for a configured line item. */
export function variantLabel(item: { color?: string | null; size?: string | null }): string {
  return [item.color, item.size ? `Size ${item.size}` : null].filter(Boolean).join(', ');
}
