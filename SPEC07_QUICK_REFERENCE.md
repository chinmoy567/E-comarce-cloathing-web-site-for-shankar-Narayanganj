# Spec 07 — Quick Reference Guide

## Status Summary

✅ **Unit Tests:** 51/51 passing  
⏳ **API Integration Tests:** Specification ready, implementation pending  
⏳ **Frontend:** Specification ready, implementation pending  

---

## Key Files

### Core Implementation
- **Schema:** `backend/migrations/0006_orders.sql`
- **Enums:** `backend/src/types/orderEnums.ts`
- **Transitions:** `backend/src/services/orderStateMachine.ts`
- **Repositories:** `backend/src/repositories/{orders,shipments,orderStatusHistory}.repository.ts`
- **Services:** `backend/src/services/{orderStatus,paymentStatus,shipmentStatus}.service.ts`

### Tests
- **Unit Tests:** `backend/tests/spec-07-order-state-machine/orderStateMachine.unit.test.ts`
- **Test Spec:** `backend/tests/spec-07-order-state-machine/SPEC07_SECURITY_TESTING.md`
- **Frontend Spec:** `frontend/SPEC07_FRONTEND_INTEGRATION.md`

### Documentation
- **Summary:** `SPEC07_IMPLEMENTATION_SUMMARY.md` (THIS FILE)
- **Quick Ref:** `SPEC07_QUICK_REFERENCE.md` (this file)

---

## Run Tests

```bash
cd backend
npm run test:spec07          # Spec 07 tests only (35 + 16 enums)
npm test                      # All backend tests
npm run test:watch           # Watch mode
```

---

## Order States

### bKash Flow
```
PENDING_CONFIRMATION
    ↓ (payment verified)
CONFIRMED
    ↓ (order processing starts)
PROCESSING
    ↓ (shipment delivered)
DELIVERED
```

### COD Flow
```
COD_VERIFICATION_PENDING
    ↓ (order verified)
CONFIRMED
    ↓ (order processing starts)
PROCESSING
    ↓ (shipment delivered)
DELIVERED
```

### Cancellation (Any State)
```
PENDING_CONFIRMATION/CONFIRMED/PROCESSING
    ↓
CANCELLED
```

### Return (from Processing)
```
PROCESSING
    ↓
RETURNED
```

---

## Payment States

### bKash
- **PENDING_VERIFICATION** (initial) → **PAID_VERIFIED** (verified) or **REJECTED** (rejected)
- **REJECTED** → **PENDING_VERIFICATION** (resubmit)

### COD
- **PENDING_COLLECTION** (initial) → **PAID_COLLECTED** (collected) or **REJECTED** (write-off)

---

## Shipment States

```
NOT_CREATED → CREATING → CREATED → SHIPPED → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED
                ↓
          CREATION_FAILED (retry → CREATING)

                                         OUT_FOR_DELIVERY → DELIVERY_FAILED (retry → IN_TRANSIT, or RETURNED)
```

---

## Permissions (RBAC)

| Action | Permission |
|--------|-----------|
| Confirm order (bKash) | `order.confirm` |
| Confirm order (COD) | `order.cod.confirm` |
| Start processing | `order.confirm` |
| Cancel order | `order.cancel` |
| Verify payment | `payment.verify` |
| Reject payment | `payment.reject` |
| Resubmit payment | `payment.review` |
| Update shipment status | `shipment.track` |
| Create shipment | `shipment.create` |
| Retry shipment | `shipment.retry` |
| View order | `order.view` |

---

## Important Rules

### 1. Three Independent Status Fields
- Order status (delivery lifecycle)
- Payment status (payment verification)
- Shipment status (courier logistics)
- **No cross-field constraints**

### 2. Valid Coexistence States
- `DELIVERED + PENDING_COLLECTION` — COD order not yet paid
- `DELIVERED + REJECTED` — COD write-off
- `PROCESSING + PENDING_VERIFICATION` — bKash payment pending

### 3. Atomic Cascades
- Shipment `DELIVERED` → Order `DELIVERED` (same transaction)
- Shipment `RETURNED` → Order `RETURNED` (same transaction)
- If order update fails, entire transaction rolls back

### 4. Payment Rules
- Rejecting payment does **NOT** cancel order (§5.21.2, CRITICAL)
- Order remains `PENDING_CONFIRMATION` after payment rejection
- Admin must manually cancel if needed

### 5. Inventory Management
- Decremented when order → `CONFIRMED`
- Restored when order → `CANCELLED` or `RETURNED` (from any state ≥ CONFIRMED)

---

## Audit Trail

Every transition writes to:
1. **order_status_history** — typed, order-scoped, fast queries
2. **audit_logs** — generic, cross-entity, compliance

Each entry includes:
- `status_field` — 'order_status', 'payment_status', or 'shipment_status'
- `previous_status` — old value (nullable)
- `new_status` — new value
- `reason` — optional explanation
- `actor_user_id` — user ID (nullable if SYSTEM)
- `actor_type` — 'USER' or 'SYSTEM'
- `created_at` — timestamp

---

## Invalid Transitions (§5.21.10)

These are explicitly rejected:
- ❌ PENDING_CONFIRMATION → PROCESSING (must go through CONFIRMED first)
- ❌ PENDING_CONFIRMATION → DELIVERED
- ❌ PENDING_CONFIRMATION → SHIPPED (invalid, order status, not shipment)
- ❌ CONFIRMED → DELIVERED (must go through PROCESSING)
- ❌ DELIVERED → CANCELLED (terminal state)
- ❌ DELIVERED → PENDING_CONFIRMATION
- ❌ COD_VERIFICATION_PENDING → SHIPPED (invalid, order status)
- ❌ PROCESSING → OUT_FOR_DELIVERY (invalid, order status)
- ❌ PROCESSING → CONFIRMED (backward transition)
- ❌ CANCELLED → PROCESSING (terminal state)
- ❌ RETURNED → PROCESSING (terminal state)

---

## Error Codes

| Code | Meaning | Example |
|------|---------|---------|
| 409 | Invalid state transition | DELIVERED → CANCELLED (not allowed) |
| 422 | Validation failed | Stock insufficient, payment not verified |
| 404 | Resource not found | Order doesn't exist |
| 403 | Insufficient permission | Manager without `order.cancel` |
| 401 | Not authenticated | Missing auth token |
| 429 | Rate limited | Too many requests |

---

## Next Steps

### Phase 2: API Integration Tests
- [ ] `orderStatus.api.test.ts` — endpoint tests
- [ ] `paymentStatus.api.test.ts` — payment flow tests
- [ ] `shipmentStatus.api.test.ts` — cascade tests
- [ ] `auditTrail.api.test.ts` — audit coverage
- [ ] Target: 50+ new tests, all passing

### Phase 3: Frontend
- [ ] Customer order tracking pages
- [ ] Admin order management dashboard
- [ ] Payment verification forms
- [ ] Status history timeline
- [ ] Target: 50+ component + integration tests

### Phase 4: Production
- [ ] Security audit (OWASP Top 10)
- [ ] Load testing
- [ ] Performance optimization
- [ ] Staging deployment

---

## Quick Debug Commands

```bash
# Check database schema
psql -U postgres -d fabrillke -c "\d orders"
psql -U postgres -d fabrillke -c "SELECT enumlabel FROM pg_enum WHERE enumtypid::regtype::text = 'order_status'"

# Run specific unit test
npm run test:spec07 -- --reporter=verbose --grep="PENDING_CONFIRMATION"

# Check test coverage (future)
npm run test:spec07 -- --coverage

# View order status history
psql -U postgres -d fabrillke -c "SELECT * FROM order_status_history WHERE order_id = '<uuid>' ORDER BY created_at DESC"

# View audit logs
psql -U postgres -d fabrillke -c "SELECT * FROM audit_logs WHERE entity_type = 'order' AND entity_id = '<uuid>' ORDER BY created_at DESC"
```

---

## Related Specs

- **Spec 01:** Customer authentication
- **Spec 02:** User identity and schema
- **Spec 03:** Audit logging (generic audit_logs table)
- **Spec 04:** Courier integration (shipment status sync, Pathao, Steadfast)
- **Spec 05:** Product catalogue (inventory management)
- **Spec 06:** RBAC (permission matrix, enforced by middleware)
- **Spec 07:** **Order/Payment/Shipment State Machine** (THIS)
- **Spec 08:** Analytics & Meta Pixel
- **Spec 09:** Fraud/risk checks
- **Spec 10:** Coupon/discount system
- **Spec 11:** Security hardening (rate limiting, DoS protection)
- **Spec 12:** WhatsApp notifications

---

## Contact & Questions

See `.claude/project requirment documents/07-order-state-machine.md` for authoritative spec.
