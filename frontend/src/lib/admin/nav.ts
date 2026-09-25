/**
 * Back-office navigation entries (spec 03 §Frontend work — "the admin app
 * shell with permission-aware navigation"). Each entry names the permission
 * key that must be present in `/auth/me`'s `permissions` array before it
 * renders — hiding a link a user cannot use is UX clarity only, the matching
 * `requirePermission` check on the backend is the real gate (`frontend` skill
 * §3).
 */
export type NavItem = {
  href: string;
  label: string;
  /** Present in the actor's effective permissions, or the item is not shown. */
  requires: string;
};

export const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: '/admin/orders', label: 'Orders', requires: 'order.view' },
  { href: '/admin/managers', label: 'Managers', requires: 'user.manager.create' },
  { href: '/admin/catalogue/products', label: 'Products', requires: 'product.update' },
  { href: '/admin/catalogue/categories', label: 'Categories', requires: 'category.manage' },
  { href: '/admin/audit-logs', label: 'Audit Log', requires: 'audit.view' },
  { href: '/admin/marketing/coupons', label: 'Coupons', requires: 'coupon.view' },
  { href: '/admin/content/homepage', label: 'Homepage', requires: 'cms.manage' },
  { href: '/admin/content/campaigns', label: 'Campaigns', requires: 'cms.manage' },
];
