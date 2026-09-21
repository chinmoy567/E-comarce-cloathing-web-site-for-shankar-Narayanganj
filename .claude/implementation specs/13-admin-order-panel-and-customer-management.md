# 13 — Admin Order Panel: Payment Verification, COD Confirmation, Cancellation, and Customer Management

## Goal

After this slice the back-office can actually run the business: Admin/Manager users see a filterable order list distinguishing bKash from COD and guest from registered, open an order detail showing the three independent statuses, review a bKash Transaction ID and screenshot, verify or reject a payment with a reason, confirm a COD order after phoning the customer, move a confirmed order into processing, and cancel orders — every one of these actions routed through spec 12's transition service under the §5.18 permission matrix. Customer management (§5.7) lands here too, since it reads the same records. Shipment creation is the one order action still missing; spec 14 adds it.

## Requirement references

- `05-admin-operations.md` §5.2 — the Order Management capability list: view new orders, dashboard notifications, order detail, customer info **including whether the order is from a registered customer or a guest**, delivery info, items and quantities, amount, payment method, submitted bKash information, Transaction ID, uploaded screenshots, verify/approve/reject bKash submissions, review resubmissions, contact customers, manage pending-verification orders, confirm orders, cancel orders, update order information per permissions, view applied coupon/discount/total; bKash and COD orders must be clearly distinguished; guest vs. registered shown on **both list and detail** as a display distinction only — same tables, same statuses, otherwise managed identically; payment, order, and shipment status displayed separately.
- `05-admin-operations.md` §5.3 — the bKash panel contents and the verification sequence; duplicate Transaction IDs are already rejected by the backend before reaching this panel, so verification is a human check of validity; a bKash order must not be confirmed before successful payment verification.
- `05-admin-operations.md` §5.4 — the COD panel contents and confirmation sequence; cancel if the customer does not confirm; payment stays `Pending Collection` until collected.
- `05-admin-operations.md` §5.7 — Customer Management: registered customers and guest references are the same kind of record distinguished by account type; view customers with a clear indicator, profile, contact, addresses, order history (including guest orders under that phone), payment-related info where permitted, shipment info, account status; manage per assigned permissions; sensitive customer information only to users with the appropriate permission.
- `03-payment-order.md` §3.4 — rejection reasons; on rejection the payment is `Rejected`, the order remains unconfirmed, the customer is notified and may resubmit; the order can only reach `Confirmed` after successful verification; Admin/Manager may cancel after a business-defined timeframe, **enforced manually via a filter/sort over stale unconfirmed orders — not an automatic or scheduled cancellation**.
- `07-order-state-machine.md` §5.21.2 — rejection stores reason, timestamp, rejecting Admin/Manager, previous submission, and new submission; previous submissions remain available.
- `07-order-state-machine.md` §5.21.3 — the COD delivered-but-uncollected discrepancy must be visible and flagged in the Order Panel, with manual resolution to `PAID_COLLECTED` or `REJECTED`.
- `07-order-state-machine.md` §5.21.9 — the transition-authorization table.
- `06-rbac.md` §5.18 — Order View, Order Update, Order Confirmation, Order Cancellation, bKash Payment View/Verification/Rejection, Payment Resubmission Review, COD Order Confirmation, Customer View, Customer Update.
- `06-rbac.md` §5.16 — permission keys; every administrative action maps to exactly one key.
- `09-fraud-risk-check.md` §7.7 — the order detail page includes a Customer Risk section (built in spec 16; the slot is defined here).
- `10-coupon-discount.md` §8.23 — the order's stored coupon snapshot is displayed and never recalculated.
- `11-security-hardening.md` §11.4 (pagination), §11.6 (validation).
- Skills: `backend` §3–4, `security` §2–4, `test` §1–2, `design` (Order Management, Order Detail, Payment Verification screens), `frontend` §3, §10.

## Depends on

- **01** — API conventions, pagination, errors.
- **02** — `customers`, `audit_logs`, `withTransaction`.
- **03** — `requireAuth('admin')`, `requirePermission`.
- **04** — `authenticatedCeiling`.
- **06** — the `payment.view`-gated signed-URL endpoint for payment screenshots.
- **11** — `orders`, `order_items`, `payments`, `payment_submissions`, `order_status_history`.
- **12** — the transition service, which is the **only** way this slice changes a status.

## Scope

**In scope**

- Admin order list with filters, search, sort, and the stale-unconfirmed view §3.4 requires.
- Admin order detail: items, amounts, coupon snapshot, three statuses, address, customer, payment submissions, status history.
- Payment verification and rejection endpoints.
- COD confirmation.
- `CONFIRMED → PROCESSING`.
- Order cancellation with a mandatory reason.
- Manual COD collection resolution (`PAID_COLLECTED` / `REJECTED`).
- Customer management: list, detail, order history, limited update.
- Dashboard counters and new-order notification.
- The admin frontend for all of the above.

**Out of scope / deferred**

- Shipment creation, courier selection, retry, change courier — spec **14**.
- Track Order and guest order lookup — spec **15**.
- Customer risk check — spec **16** (the UI slot exists here).
- Analytics and business reports (§5.9) — spec **20**.
- Customer notification delivery on rejection (§3.4 step 3) — see Open questions 1.

## Database changes

Migration file: `backend/migrations/0013_admin_order_views.sql`

No new tables. Two read-optimizing additions and one column:

- Index `orders (order_status, payment_status, placed_at DESC)` for the list's status tabs.
- Index `orders (payment_method, order_status)` for the bKash/COD split §5.2 requires.
- `orders.last_payment_rejected_at timestamptz NULL` — a denormalized copy of the most recent rejection time, written by the rejection transition, so §3.4's "filter/sort by time since rejection or since placement" does not require scanning `payment_submissions` on every list query. The authoritative record remains `payment_submissions.rejected_at`.

`payment_submissions` already carries `rejected_at`, `rejected_by`, and `rejection_reason` from spec 11.

## Backend work

### Routes

All under `/api/admin`, all with `requireAuth('admin')` + `rateLimit('authenticatedCeiling')`.

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/orders` | `order.view` |
| `GET` | `/orders/:orderNumber` | `order.view` |
| `GET` | `/orders/:orderNumber/history` | `order.view` |
| `GET` | `/orders/:orderNumber/payment` | `payment.view` |
| `POST` | `/orders/:orderNumber/payment/verify` | `payment.verify` |
| `POST` | `/orders/:orderNumber/payment/reject` | `payment.reject` |
| `POST` | `/orders/:orderNumber/confirm` | `order.confirm` |
| `POST` | `/orders/:orderNumber/cod-confirm` | `order.cod.confirm` |
| `POST` | `/orders/:orderNumber/processing` | `order.update` |
| `POST` | `/orders/:orderNumber/cancel` | `order.cancel` |
| `POST` | `/orders/:orderNumber/payment/collection` | `order.update` |
| `PATCH` | `/orders/:orderNumber` | `order.update` |
| `GET` | `/customers` | `customer.view` |
| `GET` | `/customers/:id` | `customer.view` |
| `GET` | `/customers/:id/orders` | `customer.view` |
| `PATCH` | `/customers/:id` | `customer.update` |
| `GET` | `/dashboard/summary` | `dashboard.view` |

`payment.view` gates the payment sub-resource separately from `order.view` because §5.18 lists "bKash Payment View" as its own row — a Manager could in principle hold one without the other, and the screenshot's signed URL (spec 06) is gated on the same key.

`order.cod.confirm` is a distinct route from `order.confirm` because §5.18 lists "COD Order Confirmation" as its own row. Both are `Yes` for Manager today, but folding them together would erase a matrix row.

### Types

```ts
type AdminOrderListItem = {
  orderNumber: string;
  placedAt: string;
  customerName: string;
  customerPhone: string;
  isGuestOrder: boolean;              // §5.2's Guest badge, on the list
  paymentMethod: 'BKASH' | 'COD';
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;       // §5.2: displayed separately
  shipmentStatus: ShipmentStatus;     // §5.2: displayed separately
  totalAmount: number;
  hasCouponApplied: boolean;
  hasCodCollectionDiscrepancy: boolean;  // computed (§5.21.3)
  lastPaymentRejectedAt: string | null;
};

type AdminOrderDetail = AdminOrderListItem & {
  customer: { id: string; accountType: 'GUEST' | 'REGISTERED'; email: string | null };
  deliveryAddress: {
    division: string; district: string;
    areaUnitType: 'UPAZILA' | 'THANA'; areaUnitName: string;
    wardUnitType: 'UNION' | 'WARD'; wardUnitName: string;
    detailedAddress: string; postalCode: string | null;
  };
  deliveryInstructions: string | null;
  items: Array<{ productName: string; variantLabel: string; sku: string | null;
                 unitPrice: number; quantity: number; lineTotal: number }>;
  amounts: { subtotal: number; discountAmount: number; shippingAmount: number; totalAmount: number };
  appliedCoupon: { code: string; discountType: DiscountType;
                   discountAmount: number; eligibleSubtotal: number } | null;   // §8.23 snapshot
  shipment: { courierCode: string | null; courierOrderId: string | null;
              status: ShipmentStatus; lastError: string | null } | null;
  allowedActions: string[];           // derived from the transition table + the actor's permissions
};

type PaymentPanelResponse = {         // §5.3
  method: 'BKASH' | 'COD';
  status: PaymentStatus;
  amountDue: number;
  submissions: Array<{
    id: string;
    transactionId: string | null;
    hasScreenshot: boolean;
    screenshotObjectId: string | null;   // exchanged for a signed URL via spec 06
    submittedAt: string;
    rejectedAt: string | null;
    rejectedByUserIdentifier: string | null;
    rejectionReason: string | null;
    isCurrent: boolean;
  }>;
};

type RejectPaymentRequest = { reason: string; reasonCode?: PaymentRejectionReason };
type CancelOrderRequest = { reason: string };
type CodCollectionRequest = { outcome: 'COLLECTED' | 'NOT_RECOVERABLE'; reason?: string };
```

`PaymentRejectionReason` enumerates §3.4's listed reasons — `INVALID_TRANSACTION_ID`, `TRANSACTION_MISMATCH`, `INCORRECT_AMOUNT`, `UNVERIFIABLE`, `UNCLEAR_SCREENSHOT`, `PAYMENT_NOT_COMPLETED`, `OTHER` — with free text always required alongside, since §5.21.2 requires a stored reason and the `design` skill shows a reason dropdown.

### Order list query (§5.2, §3.4)

Filters: `orderStatus[]`, `paymentStatus[]`, `shipmentStatus[]`, `paymentMethod`, `isGuestOrder`, `hasCoupon`, `hasCodDiscrepancy`, `placedFrom`/`placedTo`, and free-text `q` over order number, customer name, and phone. Sorts: `placedAt`, `totalAmount`, and — per §3.4 — `lastPaymentRejectedAt` and "time since placement" so stale unconfirmed orders surface for manual review.

`hasCodCollectionDiscrepancy` is computed in the query as `payment_method = 'COD' AND order_status = 'DELIVERED' AND payment_status = 'PENDING_COLLECTION'` (§5.21.3: a computed UI condition evaluated at display/query time, never a stored field).

A saved view — "Stale unconfirmed" — filters to `order_status IN ('PENDING_CONFIRMATION','COD_VERIFICATION_PENDING')` and `placed_at < now() - STALE_ORDER_HOURS`. §3.4 is explicit that this is a surfacing mechanism for manual action: **no background job cancels anything on a timer**, and none is built.

Always paginated (§11.4).

### Actions — all routed through spec 12

Not one handler in this slice writes a status column; each loads the order, calls a transition function, and returns the refreshed detail. The database trigger from spec 12 would reject a direct write anyway.

**Verify payment** (§5.3) — `transitionPaymentStatus(PENDING_VERIFICATION → PAID_VERIFIED)` with `payment.verify`, recording `verified_at`/`verified_by` on `payments`. The order status is **not** changed: the sequence has verification and confirmation as separate steps (7 then 8), and §5.21.11 forbids one status write leaking into another. The response then reports `confirm` as an allowed action.

**Reject payment** (§3.4, §5.21.2) — requires a reason; `transitionPaymentStatus(PENDING_VERIFICATION → REJECTED)` with `payment.reject`; writes `rejected_at`, `rejected_by`, `rejection_reason` on the current submission and `orders.last_payment_rejected_at`. **The order status does not change** and the order is not cancelled, per step 2 of that sequence. The customer may resubmit through spec 11's endpoint, which moves the payment back to `PENDING_VERIFICATION` and retains the rejected submission.

**Confirm order** — `transitionOrderStatus(→ CONFIRMED)` with `order.confirm`. Spec 12's precondition rejects a bKash order whose payment is not `PAID_VERIFIED`, per "A bKash order must not be confirmed before successful payment verification" (§3.10 rule 1, §5.3). Spec 12 also decrements stock atomically here and emits the `Purchase` hook (§5.1, §6.3). An insufficient-stock failure surfaces as `409 INSUFFICIENT_STOCK` naming the variants — the required notification.

**Confirm COD order** (§5.4) — the same `→ CONFIRMED` transition, gated on `order.cod.confirm`, rejected if the order is not COD. Payment stays `PENDING_COLLECTION` (§5.21.3).

**Processing** — `transitionOrderStatus(CONFIRMED → PROCESSING)` with `order.update`.

**Cancel** — requires a reason (§5.21.7); `transitionOrderStatus(→ CANCELLED)` with `order.cancel`. Spec 12 restores stock when the order ever reached `CONFIRMED`, leaves coupon usage untouched (§8.27), and applies the same section's courier-cancellation rule once spec 14 registers the port — blocking the cancellation if the courier shipment cannot be cancelled.

**COD collection resolution** (§5.21.3) — `COLLECTED` → `PENDING_COLLECTION → PAID_COLLECTED`; `NOT_RECOVERABLE` → `PENDING_COLLECTION → REJECTED` with a mandatory reason, leaving `order_status = 'DELIVERED'` untouched.

**`PATCH /orders/:orderNumber`** (§5.2's "update order information according to assigned permissions") — a deliberately narrow whitelist: `deliveryInstructions`, an internal note, and correctable contact fields (`contactName`, `contactPhone`, address components) **before** a shipment exists. It cannot touch any status, any amount, the coupon snapshot, or any line item, because those are owned by the transition service and by §8.23's immutability rule. Every change is audited with previous and new values.

### Customer management (§5.7)

`GET /customers` — paginated, searchable by name/phone/email, filterable by `accountType`, each row carrying the registered/guest indicator §5.7 requires.

`GET /customers/:id` — profile, contact, address, account type, account status, and aggregate order statistics. Payment-related detail is included **only** when the actor holds `payment.view` (§5.7: "Sensitive customer information must only be accessible to Admin/Manager users who have the appropriate permission"); otherwise those fields are omitted from the payload entirely rather than nulled, so their absence is not itself informative.

`GET /customers/:id/orders` — all orders under that customer record, which by construction includes guest orders placed under the same phone number (§5.7, §2.9.4), because they share one `customers` row.

`PATCH /customers/:id` — `customer.update`-gated, limited to contact and address corrections. It can never change `account_type`, create or alter credentials, or touch `users` — §2.9.8 makes the guest→registered promotion a customer-initiated, phone-verified flow, so no admin path may shortcut it.

### Dashboard (§5.2)

`GET /dashboard/summary` returns counts for new orders since the actor's last view, orders awaiting bKash verification, COD orders awaiting confirmation, orders with a rejected payment awaiting resubmission, stale unconfirmed orders, shipments in `CREATION_FAILED`, and COD collection discrepancies. §5.2 asks for "dashboard notifications for new orders"; this counter is that notification (see Open questions 2).

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| Order not found | 404 | `NOT_FOUND` |
| Transition not allowed from the current status | 409 | `INVALID_TRANSITION` |
| bKash confirm before verification | 409 | `TRANSITION_PRECONDITION_FAILED` |
| Missing rejection or cancellation reason | 400 | `REASON_REQUIRED` |
| Insufficient stock at confirmation | 409 | `INSUFFICIENT_STOCK` + variants |
| COD action on a bKash order (or vice versa) | 409 | `PAYMENT_METHOD_MISMATCH` |
| Lacking the permission | 403 | `FORBIDDEN` |
| `PATCH` touching a non-whitelisted field | 400 | `VALIDATION_ERROR` |
| Editing contact/address after a shipment exists | 409 | `ORDER_LOCKED_FOR_EDIT` |

## Frontend work

Admin routes under `frontend/src/app/admin/orders/` and `/admin/customers/`, following the `design` skill's Order Management, Order Detail, and Payment Verification screens.

**`/admin/orders`** (`design`: Order Management)
- Sticky horizontally-scrolling status tabs: All, Pending Verification, COD Pending, Confirmed, Processing, Delivered, Cancelled, Returned.
- Collapsible filter bar: search (44px), date range, payment method, guest/registered, and a **Needs attention** toggle grouping stale unconfirmed orders, rejected-payment orders, failed shipments, and COD discrepancies (§3.4, §5.21.3).
- List rows: order number (14px monospace), customer name with a **Guest** badge when applicable (§5.2), amount (14px `#DC143C` bold), three separate status badges, date (12px gray). Full-width tap target.
- Status badges use the enum values from §5.21 rendered as the §3.7/§3.8 display labels, never a merged single badge (`frontend` §2).

**`/admin/orders/[orderNumber]`** (`design`: Order Detail)
- Header with the order number; a status block showing **three separate statuses** plus a vertical history timeline from `order_status_history`.
- Customer card on `#F9FAFB`: name with Guest/Registered badge, tappable phone and email, delivery address with both discriminators spelled out ("Thana: …", "Ward: …" or "Upazila / Union" as stored).
- Items list: 60×60 image, name, variant, quantity, price, then subtotal, **coupon line when present** (code and discount, from the snapshot — §8.23), shipping, and total (§5.2).
- Payment section per §5.3: method, amount, status badge, Transaction ID in monospace, screenshot thumbnail that opens full-screen via a signed URL fetched on demand (spec 06), submission history with rejection reasons and the rejecting user.
- **Customer Risk slot** (§7.7) — rendered empty here, filled by spec 16.
- **Shipment slot** — rendered read-only here, made actionable by spec 14.
- Sticky bottom action bar showing only the actions `allowedActions` permits: Verify Payment, Reject Payment, Confirm Order, Start Processing, Cancel Order, Mark COD Collected.
- Reject Payment opens a reason dropdown (§3.4's listed reasons) plus a required free-text field; Cancel Order requires a reason. Both are destructive-styled (`#DC2626`, distinct from the primary red) per the `design` skill.
- A **COD discrepancy banner** when `hasCodCollectionDiscrepancy` is true, offering "Mark Collected" and "Mark Not Recoverable" (§5.21.3).
- Actions the actor lacks are hidden, and a 403 from the backend is still rendered as a clear message (`frontend` §3 — the UI gate is convenience, the backend is the control).

**`/admin/customers`** and **`/admin/customers/[id]`** — list with registered/guest indicator and search; detail with profile, addresses, order history, and account type. Payment-related sections render only for users holding `payment.view`.

**`/admin`** — metric cards (Total Orders, Revenue, Pending Verification, COD Pending, Needs Attention) at 60% width scrolling horizontally on mobile, a recent-orders list, and quick actions, per the `design` skill's Admin Dashboard.

All screens mobile-first at 375px with 44px minimum targets, explicit loading/empty/error/success states, and the documented palette only.

## Security requirements

- **Every action checks its own §5.18 permission** server-side; hiding a button is never the control (§5.15, §5.17). `payment.view`, `payment.verify`, `payment.reject`, `order.confirm`, `order.cod.confirm`, `order.cancel`, `order.update`, `customer.view`, and `customer.update` are checked independently.
- **No status is written directly.** Every mutation calls spec 12, which re-validates the transition, re-checks the permission, and writes the audit trail. Spec 12's database trigger makes a bypass impossible even by mistake.
- **A bKash order cannot be confirmed before verification** — enforced as a transition precondition, not as a UI rule (§5.3, §3.10 rule 1).
- **Reasons are mandatory** on rejection and cancellation, so a destructive action always carries an accountable explanation (§5.21.2, §5.21.7).
- **Payment screenshots stay private** — the panel returns an object id, and the image is fetched through spec 06's `payment.view`-gated, short-lived signed URL. The raw storage path never appears in a response.
- **Sensitive customer data is permission-scoped** (§5.7) — payment-related fields are omitted from the payload for actors without `payment.view`.
- **The `PATCH` whitelist** prevents an "update order information" permission from becoming a way to alter amounts, statuses, or the coupon snapshot (§8.23's immutability).
- **No admin path creates or alters customer credentials** — §2.9.8's promotion is customer-initiated and phone-verified.
- **All list endpoints paginate** (§11.4); all inputs use `.strict()` schemas (§11.6).
- **Every action is audited** with actor, previous and new values, and reason (§5.15 rule 10, §5.21.11).

## Data integrity / idempotency

- **Transitions are the only mutation path**, so every integrity guarantee spec 12 provides — row locking, atomic stock decrement, uniform restoration, atomic cascades, no coupon reversal — applies automatically to every action here.
- **Repeated actions are naturally idempotent-ish, and explicitly safe**: verifying an already-verified payment fails with `INVALID_TRANSITION` rather than double-writing; confirming an already-confirmed order likewise. Since `CONFIRMED` is reachable only once, stock cannot be decremented twice by a double-clicked Confirm button. A double-clicked action therefore produces one effect and one clear error, never two effects.
- **Payment submissions are append-only** — rejecting does not delete the submission, and resubmission adds a row, preserving §5.21.2's history requirement.
- **`last_payment_rejected_at` is denormalized for sorting only**; `payment_submissions.rejected_at` remains authoritative, and both are written in the same transaction.
- **No scheduled cancellation** (§3.4) — stale orders are surfaced, never auto-cancelled, so no background job can act on an order without an accountable actor.
- **The COD discrepancy is computed per query** (§5.21.3), so it cannot drift from the two statuses it derives from.

## Acceptance criteria

1. `GET /api/admin/orders` returns paginated orders with separate `orderStatus`, `paymentStatus`, and `shipmentStatus` fields and an `isGuestOrder` flag on every row.
2. Filtering by `paymentMethod=BKASH` and `COD` returns disjoint sets covering all orders (§5.2's required distinction).
3. A guest order shows `isGuestOrder: true` on both list and detail and is otherwise identical in shape to a registered order (§5.2).
4. `POST /orders/:n/payment/verify` on a `PENDING_VERIFICATION` bKash order sets `payment_status = 'PAID_VERIFIED'` and leaves `order_status = 'PENDING_CONFIRMATION'` (§5.3, §5.21.11).
5. `POST /orders/:n/confirm` before verification returns `409 TRANSITION_PRECONDITION_FAILED`; after verification it succeeds (§5.3, §3.10 rule 1).
6. Confirming decrements stock; confirming with insufficient stock returns `409 INSUFFICIENT_STOCK` naming the variants and leaves the order unconfirmed (§5.1).
7. `POST /orders/:n/payment/reject` without a reason returns `400`; with one it sets `payment_status = 'REJECTED'`, stores reason/timestamp/rejecting user, leaves `order_status = 'PENDING_CONFIRMATION'`, and does not cancel the order (§3.4, §5.21.2).
8. After a customer resubmission, the panel shows both the rejected and the new submission, with the rejection reason preserved (§5.21.2).
9. `POST /orders/:n/cod-confirm` on a COD order moves it to `CONFIRMED` with `payment_status` still `PENDING_COLLECTION` (§5.4).
10. `POST /orders/:n/cod-confirm` on a bKash order returns `409 PAYMENT_METHOD_MISMATCH`.
11. `POST /orders/:n/cancel` without a reason returns `400`; with one, the order is cancelled, stock is restored if it had been decremented, and `coupons.usage_count` is unchanged (§5.21.7, §5.1, §8.27).
12. A delivered COD order with `PENDING_COLLECTION` shows `hasCodCollectionDiscrepancy: true` on both list and detail, and no column stores it (§5.21.3).
13. Marking it `COLLECTED` sets `PAID_COLLECTED`; marking it `NOT_RECOVERABLE` with a reason sets `REJECTED` and leaves `order_status = 'DELIVERED'` (§5.21.3).
14. The detail response includes the coupon snapshot (code, type, discount, eligible subtotal) matching what was stored at placement, even after the coupon is archived (§8.23, §5.2).
15. `GET /orders/:n/payment` as a user without `payment.view` returns 403; the screenshot's signed URL is likewise refused (spec 06).
16. A Manager without `order.cancel` (an `Assigned` row) gets 403 on cancel and 200 once granted; a Manager can verify and reject payments by default (`Yes` rows).
17. `PATCH /orders/:n` with `{"totalAmount": 1}` or `{"orderStatus":"DELIVERED"}` returns `400`; with `{"deliveryInstructions":"…"}` it succeeds and is audited.
18. Editing contact/address after a shipment exists returns `409 ORDER_LOCKED_FOR_EDIT`.
19. Every action writes an `order_status_history` row and an `audit_logs` row naming the actor and reason.
20. The "Stale unconfirmed" view lists orders older than the configured threshold and **nothing is cancelled automatically** — re-querying after the threshold shows the same orders still open (§3.4).
21. `GET /customers` shows a registered/guest indicator per row; `GET /customers/:id/orders` for a customer who ordered first as a guest and later registered returns both sets (§5.7, §2.9.4).
22. `GET /customers/:id` omits payment-related fields entirely for an actor without `payment.view` (§5.7).
23. `PATCH /customers/:id` cannot change `account_type` or create credentials.
24. `GET /dashboard/summary` counts match the underlying queries.
25. At 375px the order list and detail render with no horizontal scroll (status tabs scroll horizontally by design), 44px targets, and a sticky action bar.
26. No handler in this slice contains an `UPDATE` touching a status column (verified by grep and by spec 12's trigger).

## Tests required

Per the `test` skill §1 (transitions and their authorization) and §2 (matrix rows). Integration tests against real middleware and a real database.

1. **Each action performs its documented transition** — verify, reject, confirm, COD-confirm, processing, cancel, COD collection resolution. One test per action, asserting the resulting status **and** that the other two statuses are untouched (§5.21.11).
2. **bKash confirm precondition** (§5.3, §3.10 rule 1) — rejected before verification, allowed after. The single most important business rule in this slice.
3. **Rejection does not cascade** (§5.21.2, §3.4) — order status unchanged, order not cancelled, resubmission still possible.
4. **Rejection metadata stored** (§5.21.2) — reason, timestamp, rejecting user, previous and new submissions all present after a reject→resubmit cycle.
5. **COD confirm needs no payment verification** (§5.4, §5.21.3).
6. **Method mismatch guarded** — COD actions on bKash orders and vice versa.
7. **Stock decrement and restoration through the panel** (§5.1) — confirm decrements; cancel after confirm restores; cancel before confirm restores nothing; insufficient stock blocks confirmation with a named shortfall.
8. **Coupon usage is not restored on cancel** (§8.27).
9. **Permission matrix rows** (§5.18) — one test per row touched here: `order.view`, `order.update`, `order.confirm`, `order.cancel`, `payment.view`, `payment.verify`, `payment.reject`, `payment.review`, `order.cod.confirm`, `customer.view`, `customer.update`. `Assigned` rows tested both ungranted and granted.
10. **Frontend-hiding is not a boundary** (§5.15, §5.17) — call verify, reject, confirm, and cancel directly as an unauthorized actor with no UI involved; all rejected. The `test` skill names these endpoints specifically.
11. **Reason enforcement** — rejection and cancellation both require one.
12. **Double-click safety** — two rapid confirms produce one confirmation and one `INVALID_TRANSITION`, with stock decremented exactly once.
13. **`PATCH` whitelist** — status, amount, coupon, and line-item fields all rejected; permitted fields succeed and audit.
14. **COD discrepancy is computed** (§5.21.3) — appears for the delivered/pending-collection pair, disappears on resolution, and is stored nowhere.
15. **No auto-cancellation** (§3.4) — advancing the clock past the stale threshold changes no order's status; the orders merely appear in the filter.
16. **Customer order history spans guest and registered** (§5.7, §2.9.4) — one customer record, both order sets.
17. **Sensitive customer data gated** (§5.7) — payment fields absent without `payment.view`.
18. **Audit completeness** (§5.15 rule 10, §5.21.11) — every action writes history and audit rows with actor and reason.
19. **Pagination** (§11.4) on orders and customers.

## Open questions / assumptions

1. **Customer notification on payment rejection.** §3.4 step 3 says "The customer is notified that the payment could not be verified," and §5.4 has the Admin phoning the customer, but **no PRD specifies a notification channel** — email is optional at checkout, no SMS provider exists in the stack (flagged in spec 08), and the customer capability list mentions "Receive order-status updates" without a mechanism (§2.9.2, §2). *Resolution:* the rejection reason is surfaced wherever the customer can already see their order — the guest order lookup (§2.9.6) and the account order detail — and an email is sent when an address is on file. For the remaining case (a guest with no email), **notification is an explicit operational step, not a silent gap**: the Admin/Manager already phones the customer at this point in both flows, so the rejection action in the admin panel surfaces the customer's phone number and records that contact was made, in the same audited action that sets the rejection reason (§5.3 step 3, §5.4 step 2). The customer is therefore always notified by *some* defined channel — in-app for anyone who can look the order up, email where available, and a prompted phone call otherwise.

This closes the gap without inventing a channel: spec 08's resolution establishes that no SMS provider exists in v1, so a phone call by the operator the PRD already assigns is the defined mechanism rather than a missing one. If the client later adds SMS, this becomes an automatic message with no change to the rejection flow.
2. **Dashboard "notifications for new orders."** §5.2 asks for them without specifying push, polling, or a badge. *Assumption:* a counter on the dashboard summary plus a badge on the Orders navigation entry, refreshed on page load and on an interval. Real-time push would be speculative infrastructure beyond §11.10's scope.
3. **Stale-order threshold.** §3.4 says "business-defined, typically 24-48 hours." *Assumption:* `STALE_ORDER_HOURS` defaults to 24 and is env-configurable, matching §2.5's "configurable business parameters" pattern. It only affects a filter, never an automatic action.
4. **Order editing scope.** §5.2's "Update order information according to assigned permissions" is not enumerated anywhere. *Assumption:* the narrow whitelist above — delivery instructions, internal note, and pre-shipment contact/address corrections. Amounts, statuses, coupon data, and line items are excluded because other PRD rules make them immutable or transition-owned. **Flagged:** if the client expects Admin to adjust quantities or amounts post-placement, that is a new requirement with real consequences for §8.23's snapshot immutability and the courier COD amount.
5. **`payment.review` usage.** §5.16 maps "Payment Resubmission Review" to `payment.review`, and §5.18 lists it as a row, but the reviewing action is materially the same as verify/reject on a resubmitted payment. *Assumption:* `payment.review` gates **viewing the submission history** on the payment panel (the act of reviewing resubmissions), while `payment.verify`/`payment.reject` gate the decisions. This keeps all three rows meaningful without inventing behaviour.
6. **Cancelling after a shipment exists.** §5.21.7 requires calling the courier's Cancel Shipment, but spec 14 has not yet registered the port. *Assumption:* until spec 14 lands, cancelling an order whose shipment is `CREATED` or later fails closed with `501` (spec 12's behaviour). Cancelling orders without a shipment — the overwhelmingly common case at this stage — works fully.
