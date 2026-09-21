# 20 — Analytics and Business Reports (Back-office)

## Goal

After this slice the back-office reports on the business: sales and revenue trends, order and payment breakdowns, product and stock performance, customer composition including the registered-versus-guest split, courier and shipment statistics, and coupon usage against limits. Every figure is computed from the operational tables already built, respects the Analytics View permission, and is bounded and paginated so a report can never become a denial-of-service vector. This is the last slice: it reads everything the previous nineteen wrote and adds no new business behaviour.

## Requirement references

- `05-admin-operations.md` §5.9 — the complete report inventory: **Sales** (total sales, total revenue, sales trends, average order value, sales by product, sales by category); **Orders** (total, pending, confirmed, processing, delivered, cancelled, failed, returned — with `RETURNED` meaning an undelivered parcel returned to the store, **not** a post-delivery customer return, which is out of scope for v1); **Payments** (bKash orders, COD orders, pending bKash verification, verified bKash payments, rejected bKash payments, pending COD collection, collected COD payments); **Products** (best-selling, performance, stock, out-of-stock, low-stock, category performance); **Customers** (total customers including registered **and** guest references, registered vs. guest order share, new customers, returning customers, order statistics); **Courier and Shipment** (shipments by courier, shipment status statistics, delivered, failed deliveries, returned shipments, courier performance where available); **Coupons/Discounts** (total discount given, orders with vs. without a coupon, usage per coupon against its limit, most-used coupons). **Analytics must respect the permissions assigned to each role.**
- `06-rbac.md` §5.18 — `Analytics View`: Yes for Admin, **Assigned** for Manager; `Dashboard View`: Yes/Yes; `Coupon Usage View`: Yes/Yes; `Audit Log View`: Assigned for Manager.
- `05-admin-operations.md` §5.7 — customer records include registered customers and guest references, distinguished by account type; sensitive customer information only for users with the appropriate permission.
- `10-coupon-discount.md` §8.29–8.30 — the Admin coupon list and detail views this reporting builds on; §8.30 limits per-customer usage reporting to an **aggregate** without exposing customer personal details beyond what §5.7's permissions already allow — **no new customer-data exposure is introduced by the coupon feature**.
- `07-order-state-machine.md` §5.21 — the authoritative status values every count is grouped by; §5.21.11 — the three statuses are independent, so order, payment, and shipment reports are computed from their own fields.
- `05-admin-operations.md` §5.1 — stock and low-stock data; out-of-stock is derived, never stored.
- `11-security-hardening.md` §11.4 — **pagination is mandatory on every list endpoint**; **no synchronous heavy work in the request path** — report/export generation must not run synchronously in a way a burst of requests could exploit.
- `11-security-hardening.md` §11.3 — the general authenticated per-account ceiling; §11.6 — input validation.
- `08-analytics-meta.md` §6 — Meta analytics is a separate, outbound concern; this slice is internal business reporting and introduces no Meta event.
- Skills: `database` §6 (query patterns, N+1, pagination), `security` §2, `test` §5, `design` (Admin Dashboard), `backend` §2.

## Depends on

- **01** — API conventions, pagination, errors.
- **02** — `customers`, `audit_logs`.
- **03** — `requireAuth('admin')`, `requirePermission`.
- **04** — `authenticatedCeiling`.
- **05** — products, variants, stock, categories.
- **10** — `coupons`, `coupon_usages`.
- **11** — `orders`, `order_items`, `payments`.
- **12** — status history.
- **14** — `shipments`, `couriers`.

## Scope

**In scope**

- Reporting endpoints for all seven §5.9 groups.
- A shared date-range and granularity contract.
- Materialized daily rollups for the trend reports, refreshed out of band.
- The analytics frontend under the back-office.
- CSV export, generated asynchronously per §11.4.

**Out of scope / deferred**

- Any new business behaviour — this slice only reads.
- Meta Pixel/CAPI — spec **18**.
- Post-delivery customer returns — §5.9 and §5.21.7 both place them outside v1, so "Returned" means the §5.21.7 parcel-return state only.
- Real-time dashboards or streaming — no PRD requires them, and §11.10 warns against speculative infrastructure.
- Risk-check reporting — no PRD defines any (spec 16, Open questions).

## Database changes

Migration file: `backend/migrations/0020_reporting.sql`

No new business tables. Reporting reads the operational tables; two additions keep §11.4's "no synchronous heavy work in the request path" satisfiable.

### `report_daily_sales` — a materialized rollup

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `day` | `date` | NOT NULL | PK |
| `orders_placed` | `integer` | NOT NULL | |
| `orders_confirmed` | `integer` | NOT NULL | |
| `orders_delivered` | `integer` | NOT NULL | |
| `orders_cancelled` | `integer` | NOT NULL | |
| `orders_returned` | `integer` | NOT NULL | |
| `gross_subtotal` | `numeric(14,2)` | NOT NULL | |
| `total_discount` | `numeric(14,2)` | NOT NULL | |
| `total_shipping` | `numeric(14,2)` | NOT NULL | |
| `net_revenue` | `numeric(14,2)` | NOT NULL | Sum of `total_amount` over revenue-recognized orders |
| `bkash_orders` / `cod_orders` | `integer` | NOT NULL | |
| `coupon_orders` | `integer` | NOT NULL | |
| `refreshed_at` | `timestamptz` | NOT NULL | |

Refreshed by a scheduled task (the deployment's scheduler, not an in-process timer — §11.4). Only trend and long-range reports read it; point-in-time counts (pending verification, low stock, failed shipments) query live tables, because those must be current to be operationally useful.

### Supporting indexes

- `orders (placed_at)` — range scans for every date-bounded report.
- `order_items (product_id)` and `order_items (order_id)` — best-selling and per-product aggregation.
- `shipments (courier_code, status)` — courier statistics.
- `coupon_usages (coupon_id)` — usage per coupon.
- `customers (created_at)` — new-customer counts.

## Backend work

### Shared query contract

Every report endpoint accepts the same bounded range parameters, validated by one shared schema:

```ts
type ReportRangeQuery = {
  from: string;                                   // ISO date, required
  to: string;                                     // ISO date, required
  granularity?: 'day' | 'week' | 'month';         // trends only
};
```

- `from` and `to` are required — no endpoint defaults to "all time," which would be an unbounded scan (§11.4).
- The range is capped at `REPORT_MAX_RANGE_DAYS` (default 366); a longer range is rejected with `400 RANGE_TOO_LARGE`.
- All list-shaped reports (sales by product, best-selling, low-stock, usage per coupon) are paginated with the spec 01 helper (§11.4).

### Revenue recognition

§5.9 asks for "total sales" and "total revenue" without defining when revenue counts. One rule, applied consistently and stated on every response so the number is never ambiguous:

> **Revenue is recognized on orders whose `order_status` is `DELIVERED`.** Orders in earlier states are reported as *pipeline* value, and `CANCELLED`/`RETURNED` orders are excluded from both.

This follows from the PRDs' own logic: a COD order's money is not collected until delivery (§3.2, §5.21.3), and an order can still be cancelled or returned from `PROCESSING` (§5.21.7, §5.21.6). Every sales response therefore carries three figures — `deliveredRevenue`, `pipelineValue`, and `cancelledValue` — rather than one number whose meaning must be guessed. See Open questions 1.

All amounts come from `orders.total_amount`, the server-computed discounted total (§8.15c), so reported revenue matches what was actually charged and what the courier was told to collect (§8.16a/b).

### Routes

All under `/api/admin/reports`, all with `requireAuth('admin')` + `requirePermission('analytics.view')` + `rateLimit('authenticatedCeiling')`.

| Method | Path | §5.9 group |
| --- | --- | --- |
| `GET` | `/sales/summary` | Sales |
| `GET` | `/sales/trend` | Sales |
| `GET` | `/sales/by-product` | Sales |
| `GET` | `/sales/by-category` | Sales |
| `GET` | `/orders/summary` | Orders |
| `GET` | `/payments/summary` | Payments |
| `GET` | `/products/performance` | Products |
| `GET` | `/products/stock` | Products |
| `GET` | `/customers/summary` | Customers |
| `GET` | `/shipments/summary` | Courier and Shipment |
| `GET` | `/coupons/summary` | Coupons/Discounts |
| `POST` | `/exports` | — |
| `GET` | `/exports/:id` | — |

`analytics.view` is `Assigned` for Manager (§5.18), so a Manager without the grant receives 403 on every one of these — §5.9's "Analytics should respect the permissions assigned to each role."

The dashboard summary from spec 13 stays gated on `dashboard.view` (Yes/Yes), because §5.18 separates the two rows: every Manager sees operational counters, but full reporting requires the assigned permission.

### Report shapes

```ts
type SalesSummary = {
  range: { from: string; to: string };
  deliveredRevenue: number;        // recognized (order_status = DELIVERED)
  pipelineValue: number;           // placed, not yet delivered or cancelled
  cancelledValue: number;
  ordersDelivered: number;
  averageOrderValue: number;       // deliveredRevenue / ordersDelivered
  totalDiscountGiven: number;
  totalShipping: number;
};

type OrdersSummary = {             // §5.9 Orders — grouped by §5.21 statuses
  byStatus: Record<OrderStatus, number>;
  failedShipments: number;         // shipment_status = CREATION_FAILED or DELIVERY_FAILED
  byPaymentMethod: { BKASH: number; COD: number };
};

type PaymentsSummary = {           // §5.9 Payments — every listed line
  bkashOrders: number; codOrders: number;
  bkashPendingVerification: number;
  bkashVerified: number;
  bkashRejected: number;
  codPendingCollection: number;
  codCollected: number;
  codCollectionDiscrepancies: number;   // computed (§5.21.3)
};

type CustomersSummary = {          // §5.9 Customers
  totalCustomers: number;          // registered + guest references (§2.9.4, §5.7)
  registeredCustomers: number;
  guestReferences: number;
  newCustomersInRange: number;
  returningCustomers: number;      // ≥2 orders all-time
  ordersByRegistered: number;
  ordersByGuest: number;           // the registered vs. guest order share (§5.9)
  averageOrdersPerCustomer: number;
};

type ShipmentsSummary = {          // §5.9 Courier and Shipment
  byCourier: Array<{ courierCode: string; courierName: string; total: number;
                     delivered: number; failedDelivery: number; returned: number;
                     creationFailed: number; deliverySuccessRatePercent: number | null }>;
  byStatus: Record<ShipmentStatus, number>;
};

type CouponsSummary = {            // §5.9 Coupons/Discounts, §8.29–8.30
  totalDiscountGiven: number;
  ordersWithCoupon: number;
  ordersWithoutCoupon: number;
  topCoupons: Array<{ code: string; usageCount: number; usageLimit: number | null;
                      totalDiscount: number; distinctCustomers: number }>;
};
```

`byStatus` is keyed by the §5.21 enum values, rendered with §3.7/§3.8 display labels in the UI — the report never invents a status grouping the state machine does not have.

`codCollectionDiscrepancies` is computed at query time from the two status fields (§5.21.3's computed condition), never read from a stored flag.

`distinctCustomers` on a coupon is an **aggregate count only** — §8.30 permits the count of distinct customers who used a coupon but forbids exposing customer personal details beyond §5.7's existing permissions, so no customer identity appears in any coupon report.

### Products reports

`/products/performance` — units sold, revenue, and order count per product over the range, joined from `order_items`, paginated and sorted. Best-selling is this report sorted by units.

`/products/stock` — current stock per variant with a `filter` of `all | out_of_stock | low_stock`. Out-of-stock is derived from `stock_quantity = 0` and low-stock from `stock_quantity <= low_stock_threshold` (spec 05) — §5.1's rule that out-of-stock is never a stored status holds in reporting too.

### Exports (§11.4)

§11.4 forbids synchronous report generation that "a burst of requests can exhaust server resources," so CSV export is asynchronous:

1. `POST /exports` with a report name and range → creates a job row, returns `202` with an id.
2. A worker generates the CSV and uploads it to a **private** Supabase Storage bucket (spec 06's pipeline).
3. `GET /exports/:id` returns the status and, when complete, a short-lived signed URL.

The generating query is the same one the report endpoint uses, so an export can never disagree with what the screen showed.

### Query discipline (`database` skill §6)

- Every aggregate is a single grouped SQL query — no per-row loops and no N+1 (`database` §6).
- Trend queries read `report_daily_sales`; point-in-time counts read live tables.
- Every response carries `computedAt` and, for rollup-backed figures, the rollup's `refreshed_at`, so a stale number is visibly stale rather than silently wrong.

### Error cases

| Case | Status | `code` |
| --- | --- | --- |
| Missing `from`/`to` | 400 | `VALIDATION_ERROR` |
| Range exceeds the cap | 400 | `RANGE_TOO_LARGE` |
| `from` after `to` | 400 | `VALIDATION_ERROR` |
| Missing `analytics.view` | 403 | `FORBIDDEN` |
| Export not found or not owned by the requester | 404 | `NOT_FOUND` |
| Export still running | 200 | `{ status: 'PENDING' }` |

## Frontend work

`/admin/reports`, visible only to holders of `analytics.view`.

- **Range selector** — presets (Today, 7 days, 30 days, This month, Custom) with the cap enforced and explained rather than silently truncating.
- **Sales** — the three headline figures (delivered revenue, pipeline, cancelled) each labelled with its meaning so no one mistakes pipeline for revenue; AOV; a trend chart; paginated sales-by-product and sales-by-category tables.
- **Orders** — counts per §5.21 status using §3.7's display labels, plus the payment-method split.
- **Payments** — every §5.9 payments line, with the COD discrepancy count linking through to spec 13's filtered order list so a number is actionable rather than merely informative.
- **Products** — best-selling table; stock table with out-of-stock and low-stock filters, each row linking to the product editor.
- **Customers** — total, registered vs. guest counts, new and returning, and the registered-vs-guest **order share** §5.9 asks for.
- **Shipments** — per-courier table with delivered, failed, returned, and success rate; status distribution.
- **Coupons** — total discount given, coupon vs. non-coupon order counts, and a most-used table showing usage against each limit (§8.29's `34 / 100` form).
- **Export** button per report, with a pending state and a download link when ready.
- Charts follow the `design` skill: the documented palette only, no gradients or decorative effects, readable at 375px, with a table equivalent beneath each chart so the data is accessible without relying on colour.
- Mobile: metric cards at 60% width scrolling horizontally, tables becoming stacked cards, 44px targets, explicit loading/empty/error states.
- Amounts formatted `৳ 1,500.00` and dates `DD MMM YYYY` via the shared helpers (`design` skill).

## Security requirements

- **`analytics.view` enforced server-side on every report endpoint** (§5.9, §5.18) — an `Assigned` row, so an ungranted Manager is rejected; hiding the navigation entry is not the control (§5.15, §5.17).
- **No customer personal data in reports** — customer figures are counts and aggregates only. §8.30 explicitly limits coupon reporting to aggregate per-customer usage "without exposing full customer personal details," and no report here returns a name, phone, email, or address. Customer records remain reachable only through spec 13's `customer.view`-gated endpoints.
- **No payment proof, Transaction IDs, or risk data** in any report (§6.6, §2.9.6, §4.16's prohibitions applied consistently).
- **Mandatory pagination** on every list-shaped report (§11.4).
- **Bounded ranges** — required `from`/`to` with a maximum span, so no request can trigger an unbounded scan (§11.4).
- **Asynchronous exports** (§11.4) — no synchronous heavy generation in a request handler.
- **Export files are private** — stored in a private bucket and released through a short-lived signed URL scoped to the requester (spec 06).
- **Parameterized queries throughout**; no user input is concatenated into SQL, including sort keys, which are mapped through an allowlist (§11.6, `security` §6).
- **Rate limiting** under the authenticated ceiling (§11.3).
- **Reports never write** — every endpoint is read-only, so no reporting path can affect an order, a status, or a stock level.

## Data integrity / idempotency

- **One revenue rule, stated on every response.** Recognition on `DELIVERED` is applied identically everywhere, and the three figures are always reported together so a single ambiguous "revenue" number never circulates.
- **All amounts come from `orders.total_amount`** — the discounted, server-computed total (§8.15c), so reports reconcile exactly with what was charged and with what the courier collected (§8.16a/b).
- **Status counts use the §5.21 enums directly**, so a report cannot invent or merge a status; the three status kinds are counted from their own fields, never derived from one another (§5.21.11).
- **Derived values stay derived** — out-of-stock, low-stock, and the COD collection discrepancy are all computed at query time (§5.1, §5.21.3), so no report can drift from the operational truth.
- **Rollups are recomputed, not incremented** — the scheduled refresh recalculates each day's row from source, so a re-run is idempotent and a correction upstream (a late cancellation, say) is reflected on the next refresh rather than compounding.
- **Staleness is visible** — `refreshed_at` accompanies every rollup-backed figure.
- **Exports share the report queries**, so a downloaded CSV and the screen it came from cannot disagree.
- **Reads only** — nothing in this slice mutates business data, so no integrity rule from an earlier slice can be undermined here.

## Acceptance criteria

1. `GET /api/admin/reports/sales/summary?from=…&to=…` as Admin returns delivered revenue, pipeline value, cancelled value, orders delivered, AOV, total discount, and total shipping.
2. The same request as a Manager **without** `analytics.view` returns 403; granting it returns 200 (§5.18's `Assigned` row).
3. Omitting `from` or `to` returns 400; a range longer than the cap returns `400 RANGE_TOO_LARGE`.
4. `deliveredRevenue` equals the sum of `total_amount` over `DELIVERED` orders in the range — verified against a direct SQL query.
5. An order with a coupon contributes its **discounted** total, not its subtotal (§8.15c).
6. A cancelled order appears in `cancelledValue` and in neither of the other two figures.
7. `orders/summary` returns a count for every one of the seven §5.21 order statuses, using those exact enum keys.
8. `payments/summary` returns every line §5.9 lists, and `codCollectionDiscrepancies` matches the count of `DELIVERED` + `PENDING_COLLECTION` COD orders (§5.21.3).
9. `customers/summary` counts registered customers **and** guest references in `totalCustomers`, and reports the registered-vs-guest order share (§5.9, §5.7).
10. A guest who later claimed their account (§2.9.8) is counted once, not twice — the counts are over `customers` rows.
11. `products/stock?filter=out_of_stock` lists exactly the variants with zero stock, computed from `stock_quantity` with no stored flag (§5.1).
12. `products/stock?filter=low_stock` respects each variant's own `low_stock_threshold`.
13. `sales/by-product` is paginated, never returning more than `pageSize` rows (§11.4).
14. `shipments/summary` groups by courier from the registry, and adding a third courier makes it appear with no code change (§4.9).
15. `coupons/summary` reports usage against each coupon's limit in the §8.29 form, total discount given, and coupon vs. non-coupon order counts.
16. No coupon report exposes a customer name, phone, or email — only `distinctCustomers` as a count (§8.30).
17. No report response contains a Transaction ID, payment-proof reference, risk-check result, or customer contact detail (asserted against the serialized payloads).
18. `POST /exports` returns `202` immediately and does not block; the CSV appears via `GET /exports/:id` once complete, through a signed URL that expires.
19. An export file is not publicly readable, and another admin cannot fetch a colleague's export by id.
20. A trend response carries `refreshedAt` from the rollup; a point-in-time count carries `computedAt` from the live query.
21. Re-running the rollup refresh produces identical rows (idempotent recomputation).
22. Sorting a report by an unexpected field name returns 400 rather than reaching SQL (allowlisted sort keys).
23. No report endpoint performs a write — asserted by running the full report suite against a snapshot and diffing every business table.
24. At 375px, metric cards scroll horizontally, tables stack as cards, no horizontal page scroll occurs, and every chart has a readable table equivalent.

## Tests required

Per the `test` skill §5 — reporting is read-only and lower-risk than the state machine, RBAC, and coupon areas, so coverage focuses on correctness of the figures that inform business decisions and on the §11.4 abuse-resistance rules.

1. **Revenue recognition** — delivered orders count toward revenue; pending, confirmed, and processing orders count as pipeline; cancelled and returned count in neither. One test per status, since each is a distinct accounting decision.
2. **Discounted amounts** (§8.15c) — a coupon order contributes its discounted total everywhere it appears.
3. **Status counts match the enums** (§5.21) — every order status has a bucket; no status is merged or invented.
4. **Payments breakdown completeness** (§5.9) — each of the seven listed payment figures is present and correct against seeded data.
5. **COD discrepancy count is computed** (§5.21.3) — matches the live status pair and is stored nowhere.
6. **Customer composition** (§5.9, §5.7) — registered and guest references both counted; the order share splits correctly; a claimed guest is counted once.
7. **Stock reports are derived** (§5.1) — out-of-stock and low-stock computed from stock and per-variant thresholds; no stored flag consulted.
8. **Permission enforcement** (§5.18, §5.9) — `analytics.view` required on every report endpoint, tested both ungranted and granted since it is an `Assigned` row. The most important test here, because §5.9 states the requirement explicitly.
9. **No PII in reports** (§8.30, §5.7) — a key-set assertion across every report payload confirming the absence of customer names, phones, emails, addresses, Transaction IDs, payment proof, and risk data. Written as a key-set test so a future field addition fails rather than leaks.
10. **Bounded ranges** (§11.4) — missing dates and oversized ranges rejected.
11. **Pagination** (§11.4) — every list-shaped report is bounded.
12. **Sort-key allowlist** (§11.6) — an arbitrary sort field is rejected, never interpolated.
13. **Asynchronous export** (§11.4) — the request returns immediately; the file is produced out of band; the download URL is private, scoped, and expiring.
14. **Export matches the screen** — the CSV equals the report response for the same range.
15. **Rollup idempotency** — re-running the refresh yields identical rows; a late cancellation is reflected on the next refresh.
16. **Reports perform no writes** — a full-suite run leaves every business table byte-identical.
17. **Courier grouping is registry-driven** (§4.9) — a newly added courier appears with no code change.

## Open questions / assumptions

1. **Revenue recognition point.** §5.9 asks for "total sales" and "total revenue" without defining when a sale counts, while §3.2/§5.21.3 make COD money uncollected until delivery and §5.21.6/§5.21.7 allow cancellation and return from `PROCESSING`. *Assumption:* recognize on `DELIVERED`, and always report delivered, pipeline, and cancelled figures side by side so no single ambiguous number circulates. **Flagged as a genuine definitional gap** — it materially changes every sales figure, and the client should confirm whether they think of revenue as recognized at confirmation or at delivery.
2. **"Failed orders."** §5.9's Orders group lists "Failed orders," but §5.21's order-status enum has no `FAILED` value. *Assumption:* it means orders whose **shipment** failed — `CREATION_FAILED` or `DELIVERY_FAILED` — reported as `failedShipments` and labelled as such, rather than inventing an order status the state machine does not have (§5.21 is authoritative and §5.21.10 forbids values outside the enum). **Flagged.**
3. **"Courier performance information where available."** §5.9 hedges with "where available" and no PRD defines a metric. *Assumption:* delivered / failed / returned counts and a delivery success rate computed from them — all derivable from data the platform already holds, with no external provider metric invented.
4. **"Returning customers."** §5.9 lists it without a definition. *Assumption:* customers with two or more orders all-time, counted over `customers` rows so guest references with repeat orders under one phone number are included (§2.9.4's reuse rule makes this meaningful for guests too).
5. **Trend granularity and rollup refresh cadence.** Not specified. *Assumption:* day/week/month granularity, with the daily rollup refreshed hourly by the deployment's scheduler; `refreshed_at` is always surfaced so users can see how current a figure is.
6. **Export format.** §5.9 does not mention exports at all; §11.4 only constrains how any report generation must behave. *Assumption:* CSV export is included because a reports module without one is of limited practical use, and §11.4's explicit mention of "report/export generation" implies exports were anticipated. It is built asynchronously precisely to satisfy that clause. **Flagged as an addition beyond the literal PRD text** — if unwanted, removing it costs nothing elsewhere.
7. **Charting library.** CLAUDE.md §2 fixes the stack but does not address libraries. *Assumption:* a lightweight charting library, or hand-rendered SVG, constrained to the documented palette with no gradients or decorative effects per the `design` skill. Each chart is paired with a table so the data is accessible and colour is never the sole carrier of meaning.
