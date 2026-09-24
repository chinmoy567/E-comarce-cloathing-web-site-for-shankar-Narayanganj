/**
 * The 06-rbac §5.18 permission matrix, transcribed independently of the
 * seed migration and the catalogue repository (test skill R9). Moved here
 * from `permissions.seed.test.ts` (spec 02) so spec 03's RBAC-matrix and
 * hierarchy suites can import the same oracle rather than a third copy that
 * would drift. `permissions.seed.test.ts` keeps its own copy at the data
 * layer — the independence that matters is test-vs-src, not test-vs-test.
 *
 * key -> [Admin tier, Manager tier], verbatim from the §5.18 table.
 */
export const MATRIX = {
    'dashboard.view': ['YES', 'YES'],
    'analytics.view': ['YES', 'ASSIGNED'],
    'audit.view': ['YES', 'ASSIGNED'],
    'product.create': ['YES', 'YES'],
    'product.update': ['YES', 'YES'],
    'product.delete': ['YES', 'ASSIGNED'],
    'category.manage': ['YES', 'YES'],
    'product.image.manage': ['YES', 'YES'],
    'product.attribute.manage': ['YES', 'YES'],
    'product.variant.manage': ['YES', 'YES'],
    'product.price.manage': ['YES', 'YES'],
    'inventory.manage': ['YES', 'YES'],
    'product.visibility.manage': ['YES', 'YES'],
    'order.view': ['YES', 'YES'],
    'order.update': ['YES', 'ASSIGNED'],
    'order.confirm': ['YES', 'YES'],
    'order.cancel': ['YES', 'ASSIGNED'],
    'payment.view': ['YES', 'YES'],
    'payment.verify': ['YES', 'YES'],
    'payment.reject': ['YES', 'YES'],
    'payment.review': ['YES', 'YES'],
    'order.cod.confirm': ['YES', 'YES'],
    'customer.view': ['YES', 'YES'],
    'customer.update': ['YES', 'ASSIGNED'],
    'customer.risk.check': ['YES', 'YES'],
    'shipment.view': ['YES', 'YES'],
    'shipment.create': ['YES', 'YES'],
    'courier.select': ['YES', 'YES'],
    'shipment.track': ['YES', 'YES'],
    'shipment.retry': ['YES', 'YES'],
    'shipment.courier.change': ['YES', 'YES'],
    'courier.manage': ['YES', 'ASSIGNED'],
    'cms.manage': ['YES', 'ASSIGNED'],
    'user.manager.create': ['YES', 'NO'],
    'user.manager.update': ['YES', 'NO'],
    'user.manager.delete': ['YES', 'NO'],
    'permission.assign': ['YES', 'NO'],
    'role.manage': ['YES', 'NO'],
    'permission.manage': ['YES', 'NO'],
    'system.configure': ['YES', 'NO'],
    'rbac.configure': ['YES', 'NO'],
    'coupon.view': ['YES', 'YES'],
    'coupon.create': ['YES', 'ASSIGNED'],
    'coupon.update': ['YES', 'ASSIGNED'],
    'coupon.status': ['YES', 'ASSIGNED'],
    'coupon.delete': ['YES', 'ASSIGNED'],
    'coupon.usage.view': ['YES', 'YES'],
};
/**
 * One route per permission key this slice's `Admin` routes actually gate
 * (spec 03 §Routes table). Only keys mounted behind `requirePermission` in
 * this slice have a route here; every other key is exercised at the
 * `permissions.service`/catalogue level by spec 02's suite, and will get its
 * own route entry when the owning spec mounts it.
 */
export const ROUTES = {
    'user.manager.create': { method: 'get', path: () => '/api/admin/managers' },
    'user.manager.update': {
        method: 'get',
        path: ({ managerId }) => `/api/admin/managers/${managerId}`,
    },
    'user.manager.delete': {
        // A minimal, harmless probe: DELETE on a nonexistent id would 404 for
        // anyone with the permission, but a 401/403 must never come from the
        // permission gate being absent. Callers assert `not.toContain([401,403])`.
        method: 'delete',
        path: () => `/api/admin/managers/00000000-0000-4000-8000-000000000000`,
    },
    'permission.assign': {
        method: 'put',
        path: () => `/api/admin/managers/00000000-0000-4000-8000-000000000000/permissions`,
        body: { permissions: [] },
    },
    'audit.view': { method: 'get', path: () => '/api/admin/audit-logs' },
};
