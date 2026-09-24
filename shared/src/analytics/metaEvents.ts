export const META_EVENTS = {
  PAGE_VIEW: 'PageView',
  VIEW_CONTENT: 'ViewContent',
  SEARCH: 'Search',
  ADD_TO_CART: 'AddToCart',
  INITIATE_CHECKOUT: 'InitiateCheckout',
  ADD_PAYMENT_INFO: 'AddPaymentInfo',
  PURCHASE: 'Purchase',
} as const;

export const CURRENCY = 'BDT' as const;

export type MetaEventName = (typeof META_EVENTS)[keyof typeof META_EVENTS];

export type MetaContent = {
  id: string;
  quantity: number;
  item_price: number;
};

export type MetaEventPayload = {
  event_name: MetaEventName;
  event_id: string;
  event_time: number;
  event_source_url?: string;
  content_type?: 'product';
  content_ids?: string[];
  contents?: MetaContent[];
  content_name?: string;
  content_category?: string;
  search_string?: string;
  num_items?: number;
  value?: number;
  currency?: typeof CURRENCY;
};

// Browser and Node.js both support crypto.randomUUID() on globalThis.crypto
export function newEventId(): string {
  return crypto.randomUUID();
}
