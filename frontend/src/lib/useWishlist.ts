'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getWishlistState, loadWishlist, subscribeToWishlist, type WishlistState } from './wishlist';

const SERVER_STATE: WishlistState = { status: 'unknown', items: [], ids: new Set() };

/** Reactive wishlist state; triggers the one-time load (which also probes whether the visitor is signed in). */
export function useWishlist(): WishlistState {
  const subscribe = useCallback((onChange: () => void) => subscribeToWishlist(onChange), []);
  useEffect(() => {
    if (getWishlistState().status === 'unknown') void loadWishlist();
  }, []);
  return useSyncExternalStore(subscribe, getWishlistState, () => SERVER_STATE);
}
