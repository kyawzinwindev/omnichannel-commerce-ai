import { ChatResponse } from '../ai/chat.service';
import { ChatStage, UserSessionState } from '../redis/session-state';
import { OrderSummaryResult, ProductItem } from '../store/interfaces/store-provider.interface';

export const CALLBACK_CONFIRM_ORDER = 'order:confirm';
export const CALLBACK_CANCEL_ORDER = 'order:cancel';
export const CALLBACK_EDIT_ORDER = 'order:edit';

export interface TelegramReply {
  /** HTML-formatted text (parse_mode: HTML) */
  text: string;
  /** Inline keyboard rows; undefined means no keyboard */
  keyboard?: { text: string; callback_data: string }[][];
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const money = (n: number) => `$${Number(n).toFixed(2)}`;

/** Converts light Markdown emitted by the LLM into Telegram-safe HTML. */
export function markdownToTelegramHtml(raw: string): string {
  return escapeHtml(raw)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/^\s*[-*]\s+/gm, '• ');
}

export function formatProducts(products: ProductItem[]): string {
  const cards = products.map((p) => {
    const stock = p.inStock ? '✅ In stock' : '❌ Out of stock';
    return `🛍 <b>${escapeHtml(p.name)}</b>\n💰 ${money(p.price)}  •  ${stock}`;
  });
  return `${cards.join('\n\n')}\n\n🛒 <i>Reply with the product name and quantity (e.g. "buy 2 ${escapeHtml(
    products[0].name,
  )}") to order.</i>`;
}

export function formatMissingFields(session: UserSessionState): string {
  const missing: string[] = [];
  if (!session.draftOrder.name) missing.push('👤 <b>Full name</b>');
  if (!session.draftOrder.phone) missing.push('📞 <b>Phone number</b>');
  if (!session.draftOrder.address) missing.push('📍 <b>Delivery address</b>');

  if (missing.length === 0) return '';
  return `📝 <b>To place your order I still need:</b>\n${missing.join('\n')}`;
}

export function formatDraftOrderSummary(session: UserSessionState): string {
  const lines = session.cart.map(
    (i) => `• ${escapeHtml(i.name)} × ${i.quantity} — ${money(i.price * i.quantity)}`,
  );
  const total = session.cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const { name, phone, address } = session.draftOrder;

  return [
    '🧾 <b>Order Summary</b>',
    '',
    ...lines,
    '',
    `💵 <b>Total: ${money(total)}</b>`,
    '',
    `👤 ${escapeHtml(name)}`,
    `📞 ${escapeHtml(phone)}`,
    `📍 ${escapeHtml(address)}`,
  ].join('\n');
}

export function formatOrderResult(order: OrderSummaryResult): string {
  const items = order.items.map(
    (i) => `• ${escapeHtml(i.name)} × ${i.quantity} — ${money(i.price * i.quantity)}`,
  );
  return [
    `📦 <b>Order ${escapeHtml(order.orderNumber)}</b> — <i>${escapeHtml(order.status)}</i>`,
    order.orderDate ? `🗓 ${escapeHtml(order.orderDate)}` : '',
    '',
    ...items,
    '',
    `💵 <b>Total: ${money(order.totalAmount)}</b>`,
    order.customerName ? `👤 ${escapeHtml(order.customerName)}` : '',
    order.shippingAddress ? `📍 ${escapeHtml(order.shippingAddress)}` : '',
  ]
    .filter((l, i, arr) => l !== '' || (arr[i - 1] !== '' && i !== 0))
    .join('\n');
}

/**
 * Builds the Telegram message from a ChatService response plus the post-turn session.
 */
export function buildTelegramReply(
  response: ChatResponse,
  session: UserSessionState | null,
): TelegramReply {
  const parts: string[] = [markdownToTelegramHtml(response.reply)];
  let keyboard: TelegramReply['keyboard'];

  const stage = (response.metadata?.stage as ChatStage | undefined) ?? ChatStage.IDLE;

  if (response.products && response.products.length > 0) {
    parts.push(formatProducts(response.products));
  }

  if (response.orderSummary) {
    parts.push(formatOrderResult(response.orderSummary));
  }

  if (session && stage === ChatStage.COLLECTING_USER_INFO) {
    const missing = formatMissingFields(session);
    if (missing) parts.push(missing);
  }

  if (session && stage === ChatStage.CONFIRMING_ORDER) {
    parts.push(formatDraftOrderSummary(session));
    keyboard = [
      [
        { text: '✅ Confirm Order', callback_data: CALLBACK_CONFIRM_ORDER },
        { text: '❌ Cancel / Edit', callback_data: CALLBACK_CANCEL_ORDER },
      ],
    ];
  }

  return { text: parts.join('\n\n'), keyboard };
}
