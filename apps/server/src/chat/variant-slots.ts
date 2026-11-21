import { PendingItem } from '../redis/session-state';
import { ExtractedInfo } from './intent.service';

/**
 * Validation of slot values (color / size / quantity) against a product's real options.
 * Intent detection stays LLM-driven; this only checks the extracted values against DB data.
 */

const SIZE_ALIASES: Record<string, string> = {
  'extra small': 'XS',
  'x-small': 'XS',
  xsmall: 'XS',
  small: 'S',
  medium: 'M',
  med: 'M',
  large: 'L',
  'extra large': 'XL',
  'x-large': 'XL',
  xlarge: 'XL',
  'double xl': 'XXL',
  'xx-large': 'XXL',
  xxlarge: 'XXL',
  '2xl': 'XXL',
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function normalizeSize(value: string): string {
  const v = norm(value).replace(/^size\s+/, '');
  return SIZE_ALIASES[v] ?? v.toUpperCase();
}

/** Case-insensitive color match; "grey" matches "Heather Grey", "dark red" matches "Red". */
export function matchColor(value: string, options: string[]): string | null {
  const v = norm(value);
  const exact = options.find((o) => norm(o) === v);
  if (exact) return exact;
  const partial = options.filter((o) => norm(o).includes(v) || v.includes(norm(o)));
  return partial.length === 1 ? partial[0] : null;
}

/** Sizes must match exactly after normalisation ("L" must never match "XL"). */
export function matchSize(value: string, options: string[]): string | null {
  const v = normalizeSize(value);
  return options.find((o) => normalizeSize(o) === v) ?? null;
}

/**
 * Applies extracted color / size / quantity to the pending item.
 * Returns human-readable notices for values that were rejected.
 */
export function applySlotValues(item: PendingItem, info: ExtractedInfo | undefined): string[] {
  const notices: string[] = [];
  if (!info) return notices;

  if (info.color && item.availableColors.length > 0) {
    const match = matchColor(info.color, item.availableColors);
    if (match) item.selectedColor = match;
    else
      notices.push(
        `"${info.color}" is not an available color for ${item.productName}. Available colors: ${item.availableColors.join(', ')}.`,
      );
  }

  if (info.size && item.availableSizes.length > 0) {
    const match = matchSize(info.size, item.availableSizes);
    if (match) item.selectedSize = match;
    else
      notices.push(
        `Size "${info.size}" is not available for ${item.productName}. Available sizes: ${item.availableSizes.join(', ')}.`,
      );
  }

  if (info.quantity) {
    if (typeof item.stock === 'number' && info.quantity > item.stock) {
      notices.push(
        `Only ${item.stock} of ${item.productName} left in stock; the customer asked for ${info.quantity}.`,
      );
    } else {
      item.quantity = info.quantity;
    }
  }

  return notices;
}

/** Loose "is this the same product?" check for follow-ups like "the cargo pants". */
export function isSameProduct(query: string, productName: string): boolean {
  const q = norm(query);
  const name = norm(productName);
  return name.includes(q) || q.includes(name);
}
