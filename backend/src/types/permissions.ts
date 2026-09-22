/**
 * The 47 permission keys of the 06-rbac §5.18 matrix, keyed per §5.16.
 *
 * Later specs import `PermissionKey` instead of typing permission strings
 * inline, so a typo in a `requirePermission(...)` call is a compile error
 * rather than a silently-never-granted check.
 *
 * §5.16: implementation "must not invent additional permission keys beyond
 * this table without updating both" — adding a key here without adding the
 * matching §5.18 matrix row and migration seed row is a spec violation.
 */
export const PERMISSION_KEYS = [
  'dashboard.view',
  'analytics.view',
  'audit.view',
  'product.create',
  'product.update',
  'product.delete',
  'category.manage',
  'product.image.manage',
  'product.attribute.manage',
  'product.variant.manage',
  'product.price.manage',
  'inventory.manage',
  'product.visibility.manage',
  'order.view',
  'order.update',
  'order.confirm',
  'order.cancel',
  'payment.view',
  'payment.verify',
  'payment.reject',
  'payment.review',
  'order.cod.confirm',
  'customer.view',
  'customer.update',
  'customer.risk.check',
  'shipment.view',
  'shipment.create',
  // Distinct from `courier.manage` and must stay distinct (§5.16): this is the
  // routine per-order act of picking Pathao or Steadfast.
  'courier.select',
  'shipment.track',
  'shipment.retry',
  'shipment.courier.change',
  // Provider accounts, API keys, integration settings — not per-order selection.
  'courier.manage',
  'cms.manage',
  'user.manager.create',
  'user.manager.update',
  'user.manager.delete',
  'permission.assign',
  'role.manage',
  'permission.manage',
  'system.configure',
  'rbac.configure',
  'coupon.view',
  'coupon.create',
  'coupon.update',
  'coupon.status',
  'coupon.delete',
  'coupon.usage.view',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && (PERMISSION_KEYS as readonly string[]).includes(value);
}
