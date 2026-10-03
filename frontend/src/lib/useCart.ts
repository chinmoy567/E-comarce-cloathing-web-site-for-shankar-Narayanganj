'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  getCartLines,
  getCartState,
  loadCart,
  subscribeToCart,
  type CartLine,
  type CartState,
} from './cart';

const EMPTY: CartLine[] = [];
const SERVER_STATE: CartState = { status: 'idle', cart: null };

function useCartSubscription<T>(getSnapshot: () => T, getServerSnapshot: () => T): T {
  const subscribe = useCallback((onStoreChange: () => void) => subscribeToCart(onStoreChange), []);
  // Every consumer asks for the cart to be loaded; `loadCart` deduplicates and is a no-op once loaded.
  useEffect(() => {
    if (getCartState().status === 'idle') void loadCart();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Reactive read of the server cart as display lines (spec 09). SSR-safe via `getServerSnapshot`. */
export function useCart(): CartLine[] {
  return useCartSubscription(getCartLines, () => EMPTY);
}

/** Full cart state: status plus the server-computed summary (subtotal, availability flags). */
export function useCartState(): CartState {
  return useCartSubscription(getCartState, () => SERVER_STATE);
}
