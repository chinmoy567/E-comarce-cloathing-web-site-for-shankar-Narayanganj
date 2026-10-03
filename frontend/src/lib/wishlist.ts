/**
 * Wishlist client store (spec 09). Registered customers only: the first load doubles as the session probe —
 * a 401 marks the visitor as signed out, and the UI routes them to login with a return path instead of failing
 * silently. The customer id never leaves the server; this module only holds the saved products.
 */
import { ApiClientError, apiDelete, apiGet, apiPost } from './apiClient';
import type { PublicProductListItem } from './publicTypes';

export type WishlistStatus = 'unknown' | 'signed-out' | 'ready';
export type WishlistState = { status: WishlistStatus; items: PublicProductListItem[]; ids: ReadonlySet<string> };

const listeners = new Set<() => void>();
let state: WishlistState = { status: 'unknown', items: [], ids: new Set() };
let inFlight: Promise<void> | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function setItems(items: PublicProductListItem[]): void {
  state = { status: 'ready', items, ids: new Set(items.map((i) => i.id)) };
  emit();
}

function setSignedOut(): void {
  state = { status: 'signed-out', items: [], ids: new Set() };
  emit();
}

export function getWishlistState(): WishlistState {
  return state;
}

export function subscribeToWishlist(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadWishlist(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      setItems(await apiGet<PublicProductListItem[]>('/api/customer/wishlist'));
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) setSignedOut();
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Throws ApiClientError(401) when signed out so the caller can route to login. */
export async function addToWishlist(productId: string): Promise<void> {
  setItems(await apiPost<PublicProductListItem[]>('/api/customer/wishlist', { productId }));
}

export async function removeFromWishlist(productId: string): Promise<void> {
  setItems(await apiDelete<PublicProductListItem[]>(`/api/customer/wishlist/${productId}`));
}
