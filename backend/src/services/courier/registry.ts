/**
 * Adapter registry — maps couriers.adapter_key to an implementation.
 *
 * The courier LIST is data (the `couriers` table, §4.9); this map only says which
 * code handles a row's adapter_key. Adding a third courier is a new adapter
 * module registered here plus a `couriers` insert — no enum, no order-management change.
 */

import type { CourierAdapter } from './types.js';

const adapters = new Map<string, CourierAdapter>();

export function registerAdapter(adapter: CourierAdapter): void {
  adapters.set(adapter.key, adapter);
}

export function getAdapter(adapterKey: string): CourierAdapter | undefined {
  return adapters.get(adapterKey);
}

/** Test seam: removes a registered adapter (or all, with no argument). */
export function unregisterAdapter(adapterKey?: string): void {
  if (adapterKey) adapters.delete(adapterKey);
  else adapters.clear();
}
