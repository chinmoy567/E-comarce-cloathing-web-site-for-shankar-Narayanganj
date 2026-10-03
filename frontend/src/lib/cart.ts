/**
 * Server-backed cart client (spec 09). The cart lives on the backend — a customer's account cart, or an
 * anonymous cart bound to an httpOnly `cart_token` cookie — and this module is a thin store over
 * `/api/cart`. Every price, line total and the subtotal come from the API response; nothing here ever
 * computes or sends money (CLAUDE.md §3).
 *
 * The exported `CartLine` view keeps the shape the checkout and header already consume, derived from the
 * server response. A pre-existing localStorage cart (the old client-only implementation) is imported once
 * and then removed.
 */
import { apiDelete, apiGet, apiPatch, apiPost } from './apiClient';

const LEGACY_STORAGE_KEY = 'fabrillke_cart_v1';

/** Mirrors `CartResponse` in backend/src/services/cart. Display only — the backend owns every figure. */
export type ServerCartLine = {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantLabel: string;
  image: { url: string; altText: string | null } | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'UNAVAILABLE';
  availableQuantity: number | null;
};

export type ServerCart = {
  lines: ServerCartLine[];
  itemCount: number;
  merchandiseSubtotal: number;
  hasUnavailableLines: boolean;
  currency: 'BDT';
};

export type CartLine = {
  productId: string;
  variantId: string | null;
  quantity: number;
  displaySnapshot: {
    productName: string;
    variantDescription: string | null;
    unitPrice: number;
    imageUrl: string | null;
    slug: string;
  };
};

export type CartStatus = 'idle' | 'loading' | 'ready' | 'error';
export type CartState = { status: CartStatus; cart: ServerCart | null };

const EMPTY_LINES: CartLine[] = [];
const listeners = new Set<() => void>();

let state: CartState = { status: 'idle', cart: null };
let linesCache: { source: ServerCart | null; lines: CartLine[] } = { source: null, lines: EMPTY_LINES };
let inFlight: Promise<void> | null = null;

function setState(next: CartState): void {
  state = next;
  for (const listener of listeners) listener();
}

function setCart(cart: ServerCart): void {
  setState({ status: 'ready', cart });
}

export function getCartState(): CartState {
  return state;
}

/** Stable-reference line view for `useSyncExternalStore`: same array until the server cart changes. */
export function getCartLines(): CartLine[] {
  const cart = state.cart;
  if (cart === linesCache.source) return linesCache.lines;
  linesCache = {
    source: cart,
    lines: cart
      ? cart.lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          quantity: l.quantity,
          displaySnapshot: {
            productName: l.productName,
            variantDescription: l.variantLabel || null,
            unitPrice: l.unitPrice,
            imageUrl: l.image?.url ?? null,
            slug: l.productSlug,
          },
        }))
      : EMPTY_LINES,
  };
  return linesCache.lines;
}

export function subscribeToCart(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readLegacyLines(): Array<{ variantId: string; quantity: number }> {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const v = item as { variantId?: unknown; quantity?: unknown };
      return typeof v.variantId === 'string' && typeof v.quantity === 'number' && v.quantity >= 1
        ? [{ variantId: v.variantId, quantity: Math.min(99, Math.floor(v.quantity)) }]
        : [];
    });
  } catch {
    return [];
  }
}

/** One-time import of the pre-server cart. Best effort; the key is removed either way. */
async function importLegacyCart(): Promise<void> {
  if (typeof window === 'undefined') return;
  const legacy = readLegacyLines();
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
  for (const line of legacy) {
    try {
      await apiPost<ServerCart>('/api/cart/items', { variantId: line.variantId, quantity: line.quantity });
    } catch {
      // A line that is no longer purchasable is simply dropped.
    }
  }
}

/** Loads the cart from the server (deduplicated). Safe to call from every consumer. */
export function loadCart(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (inFlight) return inFlight;
  if (state.status === 'idle') setState({ status: 'loading', cart: state.cart });
  inFlight = (async () => {
    try {
      await importLegacyCart();
      setCart(await apiGet<ServerCart>('/api/cart'));
    } catch {
      setState({ status: 'error', cart: state.cart });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Re-fetches after a failed mutation or a login/logout so the view never drifts from the server. */
export function refreshCart(): Promise<void> {
  return loadCart();
}

/** Adds a variant (quantity increments if the line exists). The caller handles `ApiClientError`. */
export async function addToCart(variantId: string, quantity: number): Promise<void> {
  setCart(await apiPost<ServerCart>('/api/cart/items', { variantId, quantity }));
}

export async function updateCartQuantity(variantId: string, quantity: number): Promise<void> {
  if (quantity <= 0) {
    await removeFromCart(variantId);
    return;
  }
  setCart(await apiPatch<ServerCart>(`/api/cart/items/${variantId}`, { quantity }));
}

export async function removeFromCart(variantId: string): Promise<void> {
  setCart(await apiDelete<ServerCart>(`/api/cart/items/${variantId}`));
}

export async function clearCart(): Promise<void> {
  setCart(await apiDelete<ServerCart>('/api/cart'));
}
