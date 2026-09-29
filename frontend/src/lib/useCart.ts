'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { getCartLines, subscribeToCart, type CartLine } from './cart';

const EMPTY: CartLine[] = [];

/** Reactive read of the client-side cart (spec 11). SSR-safe via `getServerSnapshot`. */
export function useCart(): CartLine[] {
  const subscribe = useCallback((onStoreChange: () => void) => subscribeToCart(onStoreChange), []);
  const getSnapshot = useCallback(() => getCartLines(), []);
  const getServerSnapshot = useCallback(() => EMPTY, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
