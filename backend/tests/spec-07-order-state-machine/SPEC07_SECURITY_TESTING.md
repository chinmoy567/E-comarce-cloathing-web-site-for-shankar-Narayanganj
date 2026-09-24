# Spec 07 — Order/Payment/Shipment State Machine: Security & Integration Testing

## Overview

Spec 07 implements the authoritative order state machine per 07-order-state-machine.md §5.21. This document specifies:

1. **Unit Tests** (✅ Implemented) — Transition table validation without database
2. **API Integration Tests** (⏳ To Implement) — Full HTTP endpoint security and behavior
3. **Security Testing** (⏳ To Implement) — RBAC enforcement, input validation, rate limiting
4. **Frontend Integration** (⏳ To Implement) — Customer order tracking and management

---

## 1. Unit Tests (✅ Complete)

**File:** `orderStateMachine.unit.test.ts`

**Coverage:** 35 tests validating the pure transition tables.

- ✅ All valid transitions per payment method (bKash, COD)
- ✅ All 11 invalid transitions from §5.21.10
- ✅ Payment status transitions (PENDING_VERIFICATION → PAID_VERIFIED/REJECTED, resubmit)
- ✅ Shipment status transitions and failure paths
- ✅ Initial state assignment per payment method
- ✅ Enum parity across 4 new + 2 existing enums

**Run:** `npm run test:spec07`

---

## 2. API Integration Tests (⏳ Required)

### 2.1 Order Status Endpoints

#### POST /api/admin/orders/:id/confirm

**Security Tests:**
- [ ] Rejects 401 (no auth token)
- [ ] Rejects 403 (insufficient permission: requires `order.confirm` for bKash or `order.cod.confirm` for COD)
- [ ] Accepts 200 (admin with permission)
- [ ] Returns 409 if order is not in a transitionable state

**Behavior Tests:**
- [ ] Validates PENDING_CONFIRMATION → CONFIRMED for bKash
- [ ] Validates COD_VERIFICATION_PENDING → CONFIRMED for COD
- [ ] Rejects if payment_status is not PAID_VERIFIED (bKash) or PENDING_COLLECTION (COD)
- [ ] Calls inventory.conditionalDecrement per line item (stock must exist)
- [ ] Returns 422 if any line item is oversold
- [ ] Creates order_status_history entry with actor_type='USER'
- [ ] Creates audit_logs entry
- [ ] Rolls back entire transaction if any step fails

**Input Validation:**
- [ ] Rejects unknown request body fields
- [ ] Accepts optional `reason` field

#### POST /api/admin/orders/:id/processing

**Security Tests:**
- [ ] Requires permission: `order.confirm`
- [ ] Returns 403 if insufficient permission

**Behavior Tests:**
- [ ] Validates CONFIRMED → PROCESSING transition only
- [ ] Rejects with 409 if order not in CONFIRMED state
- [ ] Creates audit trail entries

#### POST /api/admin/orders/:id/cancel

**Security Tests:**
- [ ] Requires permission: `order.cancel`
- [ ] Returns 403 if insufficient permission

**Behavior Tests:**
- [ ] Allows cancel from PENDING_CONFIRMATION, CONFIRMED, PROCESSING (bKash routes)
- [ ] Allows cancel from COD_VERIFICATION_PENDING, CONFIRMED, PROCESSING (COD routes)
- [ ] Rejects from DELIVERED (§5.21.10)
- [ ] Calls inventory.unconditionalIncrement per line item
- [ ] Stores cancellation_reason, cancelled_at, cancelled_by
- [ ] Returns 409 with correct error message for invalid transitions

**Input Validation:**
- [ ] Requires `reason` field (non-empty string)

### 2.2 Payment Status Endpoints

#### POST /api/admin/orders/:id/payments/verify

**Security Tests:**
- [ ] Requires permission: `payment.verify`
- [ ] Returns 403 if insufficient permission

**Behavior Tests (bKash):**
- [ ] Validates PENDING_VERIFICATION → PAID_VERIFIED
- [ ] Rejects 409 if order not in PENDING_VERIFICATION state
- [ ] Does NOT auto-cancel order (§5.21.2)
- [ ] Creates order_status_history entry with status_field='payment_status'
- [ ] Stores bKash transaction ID in metadata (if applicable)

**Behavior Tests (COD):**
- [ ] Validates PENDING_COLLECTION → PAID_COLLECTED
- [ ] Allows transaction from any order_status (especially DELIVERED per §5.21.3)

**Input Validation:**
- [ ] bKash: requires `bkashTransactionId` (non-empty string, format validation)
- [ ] COD: no transaction ID required

#### POST /api/admin/orders/:id/payments/reject

**Security Tests:**
- [ ] Requires permission: `payment.reject`
- [ ] Returns 403 if insufficient permission

**Behavior Tests (bKash):**
- [ ] Validates PENDING_VERIFICATION → REJECTED
- [ ] Does NOT auto-cancel order (§5.21.2, critical)
- [ ] Order remains in PENDING_CONFIRMATION

**Behavior Tests (COD):**
- [ ] Validates PENDING_COLLECTION → REJECTED
- [ ] Allows from DELIVERED state (manual write-off, §5.21.3)

**Input Validation:**
- [ ] Requires `reason` field (non-empty string)
- [ ] Stores rejection timestamp and rejecting user

#### POST /api/admin/orders/:id/payments/resubmit

**Security Tests:**
- [ ] Requires permission: `payment.review`
- [ ] Returns 403 if insufficient permission

**Behavior Tests:**
- [ ] Validates REJECTED → PENDING_VERIFICATION (bKash only)
- [ ] Allows customer to resubmit with new transaction ID
- [ ] Stores new transaction ID, clears old one
- [ ] Returns 409 if order payment_status not REJECTED

**Input Validation:**
- [ ] Requires `newBkashTransactionId` (non-empty string)

### 2.3 Shipment Status Endpoints

#### POST /api/admin/shipments/:orderId/status

**Security Tests:**
- [ ] bKash/COD: any manual status update requires `shipment.track`
- [ ] System (courier sync): verifies webhook signature (out of scope, deferred to spec 4)

**Behavior Tests:**
- [ ] Validates all transitions per SHIPMENT_STATUS_TRANSITIONS table
- [ ] OUT_FOR_DELIVERY → DELIVERED cascades to Order PROCESSING → DELIVERED (§5.21.4)
- [ ] DELIVERY_FAILED → RETURNED cascades to Order PROCESSING → RETURNED (§5.21.6)
- [ ] Defensive check: order must be PROCESSING when cascade fires, else 409
- [ ] Creates shipments table entries with order_id, courier, courier_order_id
- [ ] Creates order_status_history entries for shipment_status changes
- [ ] Cascaded order_status changes also recorded in history

**Input Validation:**
- [ ] Requires `newStatus` from SHIPMENT_STATUSES enum
- [ ] Requires valid order_id (returns 404 if order not found)
- [ ] Rejects unknown fields

### 2.4 Order List & Retrieval

#### GET /api/admin/orders

**Security Tests:**
- [ ] Requires authentication
- [ ] Requires `order.view` permission
- [ ] Returns 403 if insufficient permission

**Pagination & Filtering:**
- [ ] Mandatory pagination (§11.4): max 100 per page
- [ ] Supports filter by `order_status`, `payment_status`, `payment_method`
- [ ] Supports filter by date range: `created_after`, `created_before`
- [ ] Supports sort by `created_at`, `updated_at`
- [ ] Returns 400 if limit > 100

**Rate Limiting:**
- [ ] Per-account request ceiling (spec 11.3)

#### GET /api/admin/orders/:id

**Security Tests:**
- [ ] Requires `order.view` permission

**Response:**
- [ ] Returns full order record: id, order_number, customer_id, payment_method, order_status, payment_status, amounts, coupon, cancellation fields
- [ ] Includes shipment record (1:1 relationship)
- [ ] Returns 404 if not found

#### GET /api/admin/orders/:id/history

**Security Tests:**
- [ ] Requires `order.view` permission

**Response:**
- [ ] Returns order_status_history records for order, paginated
- [ ] Each record: status_field, previous_status, new_status, reason, actor_user_id, actor_type, created_at
- [ ] Sorted by created_at DESC

---

## 3. Security & RBAC Tests (⏳ Required)

### 3.1 Permission Matrix Enforcement

| Endpoint | Required Permission | Role |
|----------|-------------------|------|
| POST /orders/:id/confirm | order.confirm (bKash) or order.cod.confirm (COD) | ADMIN, MANAGER (assigned) |
| POST /orders/:id/processing | order.confirm | ADMIN, MANAGER (assigned) |
| POST /orders/:id/cancel | order.cancel | ADMIN, MANAGER (assigned) |
| POST /orders/:id/payments/verify | payment.verify | ADMIN, MANAGER (assigned) |
| POST /orders/:id/payments/reject | payment.reject | ADMIN, MANAGER (assigned) |
| POST /orders/:id/payments/resubmit | payment.review | ADMIN, MANAGER (assigned) |
| POST /shipments/:orderId/status | shipment.track | ADMIN, MANAGER (assigned) |
| GET /orders | order.view | ADMIN, MANAGER, CUSTOMER (own orders only) |
| GET /orders/:id | order.view | ADMIN, MANAGER, CUSTOMER (own orders only) |
| GET /orders/:id/history | order.view | ADMIN, MANAGER |

### 3.2 Input Validation Tests

- [ ] All endpoints reject Content-Type other than application/json
- [ ] All POST endpoints validate request body against schema
- [ ] Unknown fields rejected
- [ ] Required fields validation
- [ ] Enum value validation
- [ ] UUID format validation for order_id
- [ ] Phone format validation (for customer orders)

### 3.3 Injection Prevention

- [ ] SQL injection: all queries use parameterized statements (no raw SQL)
- [ ] XSS: reason/cancellation_reason fields sanitized on storage
- [ ] No order status/payment status enum values are injectable

### 3.4 Rate Limiting (per spec 11.2, 11.3)

- [ ] Admin/Manager: per-account + per-IP limiting on all POST endpoints
- [ ] 429 response with Retry-After header when exceeded
- [ ] Rate-limit rejections logged to audit_logs
- [ ] No information leakage about whether order exists when rate-limited

---

## 4. Atomicity & Data Integrity Tests (⏳ Required)

### 4.1 Transaction Boundaries

- [ ] Order status update + audit trail write in same transaction
- [ ] Payment status update + audit trail write in same transaction
- [ ] Shipment status update + audit trail write in same transaction
- [ ] Inventory decrement (on CONFIRMED) + order status update in same transaction
- [ ] Inventory increment (on cancel/return) + order status update in same transaction

### 4.2 Cascade Atomicity (§5.21.4, §5.21.6)

- [ ] Shipment DELIVERED → Order DELIVERED in same transaction
- [ ] Shipment RETURNED → Order RETURNED in same transaction
- [ ] If order update fails, entire transaction (including shipment) rolls back
- [ ] Order must be PROCESSING when cascade fires, else transaction fails defensively

### 4.3 Race Condition Handling

- [ ] Concurrent POST /orders/:id/confirm requests: only one succeeds (row locking)
- [ ] Concurrent payment transitions on same order: first wins, second gets 409
- [ ] Stock decrement: no double-decrement due to optimistic lock or transaction isolation

### 4.4 Duplicate Prevention

- [ ] order_number UNIQUE constraint prevents duplicate order creation
- [ ] Idempotency key handling (if order creation includes this, test that duplicate requests return same order)

---

## 5. Audit Trail & Logging Tests (⏳ Required)

### 5.1 order_status_history Coverage

- [ ] Every order_status transition creates entry with: order_id, status_field='order_status', previous/new_status, actor_user_id, actor_type, reason, created_at
- [ ] Every payment_status transition creates entry with: status_field='payment_status', previous/new_status
- [ ] Every shipment_status transition creates entry with: status_field='shipment_status', previous/new_status
- [ ] Actor type: 'USER' for admin/manager manual actions, 'SYSTEM' for courier sync/cascade
- [ ] Reason field present for manual transitions, optional for system (but recommended, e.g., "Cascade from shipment DELIVERED")

### 5.2 audit_logs Coverage (generic audit trail, spec 03)

- [ ] Every state transition also written to audit_logs with entity_type='order', entity_id=order_id
- [ ] User identification: actor_id (if USER), or null/system marker if SYSTEM
- [ ] IP address logged (if available in request context)

---

## 6. Coexistence Rules (§5.21.3)

### Tests for Valid Order + Payment Combinations

- [ ] DELIVERED + PENDING_COLLECTION: valid state per spec
  - Order delivered, but customer hasn't paid COD yet
  - Admin can collect payment or write it off
  - No database constraint forbids this

- [ ] DELIVERED + REJECTED: valid state per spec
  - Order delivered, but payment was explicitly rejected (write-off)
  - No database constraint forbids this

- [ ] DELIVERED + PAID_COLLECTED: valid state
  - Order delivered and payment collected (happy path)

- [ ] PROCESSING + PENDING_VERIFICATION: valid state (bKash)
  - Order being prepared, payment verification pending

### Test Implementation

- Create orders with each combination
- Verify GET /api/admin/orders/:id returns correct statuses
- Verify no constraint violation on save
- No cross-field UPDATE that would prevent these states

---

## 7. COD-Specific Tests (§5.21.2, §5.21.3)

- [ ] COD orders initialize with: order_status=COD_VERIFICATION_PENDING, payment_status=PENDING_COLLECTION
- [ ] COD_VERIFICATION_PENDING → CONFIRMED requires `order.cod.confirm` permission
- [ ] COD payment collection can occur when order is DELIVERED (§5.21.3)
- [ ] COD rejection creates DELIVERED + REJECTED state (write-off)
- [ ] COD cannot use payment.review/resubmit (no resubmission for COD)

---

## 8. Frontend Integration Tests (⏳ Required)

### 8.1 Customer Order Tracking

**Page:** `/customer/orders/:orderNumber`

- [ ] Displays current order_status, payment_status, shipment_status
- [ ] Updates in real-time (polling or WebSocket)
- [ ] Shows status history timeline (via GET /api/orders/:id/history)
- [ ] Displays payment submission form for bKash if order in PENDING_CONFIRMATION
- [ ] Displays "payment rejected, resubmit" UI if payment_status=REJECTED
- [ ] Shows shipment tracking if shipment exists

### 8.2 Admin Order Management Dashboard

**Page:** `/admin/orders`

- [ ] Filters by order_status, payment_status, payment_method
- [ ] Paginated list view (max 100 per page)
- [ ] Links to detailed order page

**Page:** `/admin/orders/:id`

- [ ] Edit order status: dropdown/buttons for valid transitions
- [ ] Edit payment status: conditional UI (bKash verify/reject/resubmit vs COD collect/reject)
- [ ] Status history timeline showing full chain of changes
- [ ] Audit trail link (who made changes, when, from what IP)
- [ ] Inventory adjustment UI (if order modified)

### 8.3 Form Validation

- [ ] bKash transaction ID format validation (frontend + backend)
- [ ] Reason field required for cancel/reject
- [ ] Error message display for 409 (transition rejected)
- [ ] Error message display for 422 (validation failed)
- [ ] Loading state during API request
- [ ] Disable form while request in flight

---

## 9. Error Handling Tests (⏳ Required)

### 9.1 Invalid Transitions (409 Conflict)

- [ ] PENDING_CONFIRMATION → PROCESSING: "This order must be confirmed before processing"
- [ ] DELIVERED → CANCELLED: "Delivered orders cannot be cancelled"
- [ ] CONFIRMED → DELIVERED (direct): "Invalid transition; order must be processed first"

### 9.2 State Constraint Violations (422)

- [ ] Oversold inventory on confirm: "Insufficient stock for product X"
- [ ] payment_status mismatch on confirm: "Payment must be verified before confirming"
- [ ] order_status mismatch on payment action: "Cannot verify payment for a completed order"

### 9.3 Not Found (404)

- [ ] Order not found
- [ ] Shipment not found

### 9.4 Unauthorized (401)

- [ ] Missing Authorization header

### 9.5 Forbidden (403)

- [ ] Valid token but insufficient permission

### 9.6 Rate Limited (429)

- [ ] Too many requests from same account/IP
- [ ] Retry-After header present

---

## 10. Performance & Load Tests (⏳ Optional)

- [ ] Confirm 1000 orders concurrently: no deadlocks, all succeed or fail cleanly
- [ ] List 10k orders with pagination: response < 1s
- [ ] Shipment cascade with large line-item count: sub-second atomicity
- [ ] Audit trail query for order with 100+ transitions: < 500ms

---

## Test Execution Plan

### Phase 1: Unit Tests (✅ Done)
- `npm run test:spec07` — 35 + 16 enum tests passing

### Phase 2: API Integration Tests (⏳ Next)
- Create `orderStatus.api.test.ts` — confirm, cancel, processing endpoints
- Create `paymentStatus.api.test.ts` — bKash/COD payment transitions
- Create `shipmentStatus.api.test.ts` — shipment cascades
- Create `atomicCascade.test.ts` — transaction atomicity verification
- Create `auditTrail.api.test.ts` — history and audit_logs coverage
- Run: `npm run test:spec07` (should include all API tests)

### Phase 3: Frontend Tests (⏳ Next)
- Create `frontend/tests/integration/customer-order-tracking.test.tsx`
- Create `frontend/tests/integration/admin-order-management.test.tsx`
- Run: `npm run test:frontend`

### Phase 4: Manual Security Audit (⏳ Next)
- OWASP Top 10 checklist per spec 11-security-hardening
- Rate limiting under load
- Concurrent request race conditions
- Audit log verification for compliance

---

## Security Checklist (11-security-hardening)

- [ ] 11.2 Rate Limiting: per-account + per-IP enforcement
- [ ] 11.4 DoS Mitigation: pagination mandatory, no unbounded list
- [ ] 11.5 Headers: helmet security headers, CORS restricted
- [ ] 11.6 Input Validation: Zod schema, no raw SQL, HTML sanitization
- [ ] 11.7 Auth & Session: JWT short-lived, RBAC re-checked per request
- [ ] 11.8 Payment Security: amounts recalculated server-side, no client totals trusted

---

## Notes

- All API tests must use real Postgres schema fixture (scopedUrl) to test actual constraints
- All tests must set up required foreign keys (customers, users, products) before testing orders
- API tests should not mock the database; use withSchema for isolation
- Atomicity tests require transaction control; verify via deliberate rollback simulation
- Frontend tests require a running dev server or use headless browser (e.g., Playwright)
