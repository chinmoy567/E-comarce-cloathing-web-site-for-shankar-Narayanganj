import { randomUUID } from 'crypto';
export const META_EVENTS = {
    PAGE_VIEW: 'PageView',
    VIEW_CONTENT: 'ViewContent',
    SEARCH: 'Search',
    ADD_TO_CART: 'AddToCart',
    INITIATE_CHECKOUT: 'InitiateCheckout',
    ADD_PAYMENT_INFO: 'AddPaymentInfo',
    PURCHASE: 'Purchase',
};
export const CURRENCY = 'BDT';
export function newEventId() {
    return randomUUID();
}
