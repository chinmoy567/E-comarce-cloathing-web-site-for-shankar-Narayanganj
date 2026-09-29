/**
 * Client-side cart store (spec 11 — 02-customer §2.9.1 step 1 "adds products
 * to cart"). No backend cart endpoint exists (grepped) and none is required
 * by any spec doc — the cart is purely a client-side line-item list until
 * checkout, matching `CouponField`'s existing `{variantId, quantity}` shape
 * and `checkout.service.ts`'s `CheckoutLineInput`. The backend is always the
 * source of truth for price/stock/availability at checkout time (CLAUDE.md
 * §3) — this module never stores or trusts a price.
 *
 * Persisted to localStorage so the cart survives a reload/navigation for both
 * a guest and a logged-in customer (there is no server-side cart to sync to).
 */

const CART_STORAGE_KEY = 'fabrillke_cart_v1';

export type CartLine = {
  productId: string;
  variantId: string | null;
  quantity: number;
  /** Display-only snapshot captured at add-to-cart time; never sent to the order-creation API and never trusted over the live price at checkout. */
  displaySnapshot: {
    productName: string;
    variantDescription: string | null;
    unitPrice: number;
    imageUrl: string | null;
    slug: string;
  };
};

type CartChangeListener = () => void;

const listeners = new Set<CartChangeListener>();

function lineKey(line: Pick<CartLine, 'productId' | 'variantId'>): string {
  return `${line.productId}:${line.variantId ?? ''}`;
}

function readRaw(): CartLine[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CartLine =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as CartLine).productId === 'string' &&
        typeof (item as CartLine).quantity === 'number',
    );
  } catch {
    return [];
  }
}

function writeRaw(lines: CartLine[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Storage unavailable (private browsing, quota) — cart simply won't persist.
  }
  for (const listener of listeners) listener();
}

let snapshotRaw: string | null | undefined;
let snapshotLines: CartLine[] = [];

/**
 * Stable-reference snapshot for `useSyncExternalStore`: the same array instance is
 * returned until the persisted cart actually changes (a fresh parse per call would
 * make React see a new value every render and loop forever).
 */
export function getCartLines(): CartLine[] {
  if (typeof window === 'undefined') return snapshotLines;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(CART_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshotLines = readRaw();
  }
  return snapshotLines;
}

export function getCartCount(): number {
  return readRaw().reduce((sum, line) => sum + line.quantity, 0);
}

export function addToCart(line: CartLine): void {
  const lines = readRaw();
  const key = lineKey(line);
  const existing = lines.find((l) => lineKey(l) === key);
  if (existing) {
    existing.quantity += line.quantity;
    existing.displaySnapshot = line.displaySnapshot;
  } else {
    lines.push(line);
  }
  writeRaw(lines);
}

export function updateCartQuantity(productId: string, variantId: string | null, quantity: number): void {
  const lines = readRaw();
  const key = lineKey({ productId, variantId });
  if (quantity <= 0) {
    writeRaw(lines.filter((l) => lineKey(l) !== key));
    return;
  }
  const existing = lines.find((l) => lineKey(l) === key);
  if (existing) {
    existing.quantity = quantity;
    writeRaw(lines);
  }
}

export function removeFromCart(productId: string, variantId: string | null): void {
  const lines = readRaw();
  const key = lineKey({ productId, variantId });
  writeRaw(lines.filter((l) => lineKey(l) !== key));
}

export function clearCart(): void {
  writeRaw([]);
}

/** Subscribes to cart changes made anywhere in this tab (or another tab, via the storage event). Returns an unsubscribe function. */
export function subscribeToCart(listener: CartChangeListener): () => void {
  listeners.add(listener);
  function onStorage(e: StorageEvent) {
    if (e.key === CART_STORAGE_KEY) listener();
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}
