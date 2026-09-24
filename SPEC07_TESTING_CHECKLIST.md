# Spec 07 — Comprehensive Testing & Security Checklist

**Objective:** Test Spec 07 (Order/Payment/Shipment State Machine) thoroughly for security, correctness, and website integration.

**Completion Status:** Core implementation ✅ | API Endpoints ⏳ | Frontend ⏳ | Security Testing ⏳

---

## Phase 1: Unit Test Verification (✅ COMPLETE)

### ✅ Already Passing (51/51 tests)

```bash
npm run test:spec07
```

**Results:**
- 35 state machine transition tests
- 16 enum parity tests
- All tests passing
- 100% coverage of transition table logic

---

## Phase 2: Security Testing Checklist

### 2.1 Authentication & Authorization

**Test:** Admin login and permission enforcement

```bash
# Manual test with credentials (use your screenshot)
curl -X POST http://localhost:4000/api/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com",
    "password": "your-password"
  }'

# Expected response:
# {
#   "token": "jwt-token-here",
#   "user": { "id": "...", "email": "...", "role": "ADMIN" }
# }
```

**Checklist:**
- [ ] Login returns valid JWT token
- [ ] Token expires after configured time
- [ ] Expired token returns 401 on subsequent requests
- [ ] Invalid credentials return 401 (not 404)
- [ ] Password hash is bcrypt (not plaintext)
- [ ] Rate limiting on login (max 5 attempts per 15 min)

### 2.2 Input Validation

**Test:** API input validation for all order endpoints

```bash
# Test 1: Missing required field
curl -X POST http://localhost:4000/api/admin/orders/:id/cancel \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' # Missing 'reason'

# Expected: 422 Unprocessable Entity
# Response: { "error": "Reason is required" }
```

**Checklist:**
- [ ] Required fields validation (reason, transaction ID, etc.)
- [ ] Field length validation (min/max chars)
- [ ] UUID format validation for order ID
- [ ] Enum value validation (only valid statuses accepted)
- [ ] Unknown fields rejected
- [ ] SQL injection attempts blocked (parameterized queries)

### 2.3 Permission Matrix Enforcement

**Test:** Only authorized users can perform actions

```bash
# Test 1: Manager without 'order.confirm' permission
curl -X POST http://localhost:4000/api/admin/orders/:id/confirm \
  -H "Authorization: Bearer $MANAGER_TOKEN_WITHOUT_PERMISSION" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Manual confirmation"}'

# Expected: 403 Forbidden
# Response: { "error": "Missing permission: order.confirm" }
```

**Checklist:**
- [ ] POST /orders/:id/confirm — requires `order.confirm` (bKash) or `order.cod.confirm` (COD)
- [ ] POST /orders/:id/cancel — requires `order.cancel`
- [ ] POST /orders/:id/payments/verify — requires `payment.verify`
- [ ] POST /orders/:id/payments/reject — requires `payment.reject`
- [ ] POST /orders/:id/payments/resubmit — requires `payment.review`
- [ ] GET /orders — requires `order.view`
- [ ] Unauthenticated requests return 401
- [ ] Frontend hiding button is NOT security boundary (test via API directly)

### 2.4 Rate Limiting (Spec 11.2)

**Test:** Rate limit enforcement

```bash
# Send 6 payment verification requests in quick succession
for i in {1..6}; do
  curl -X POST http://localhost:4000/api/admin/orders/:id/payments/verify \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"bkashTransactionId": "TX'$i'"}'
done

# Expected (6th request): 429 Too Many Requests
# Headers: Retry-After: 60
# Response: { "error": "Too many requests, please try again later" }
```

**Checklist:**
- [ ] Rate limit per account + IP (not just IP)
- [ ] 429 response with Retry-After header
- [ ] Rate limit rejections logged to audit_logs
- [ ] No information leak (same message for rate-limited vs valid request)
- [ ] Rate limits are configurable via environment variables

### 2.5 Audit Trail & Logging

**Test:** Every state transition is recorded

```bash
# 1. Confirm an order
curl -X POST http://localhost:4000/api/admin/orders/:id/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Payment verified"}'

# 2. Fetch history
curl -X GET http://localhost:4000/api/admin/orders/:id/history \
  -H "Authorization: Bearer $TOKEN"

# Expected response:
# [{
#   "id": "...",
#   "order_id": "...",
#   "status_field": "order_status",
#   "previous_status": "PENDING_CONFIRMATION",
#   "new_status": "CONFIRMED",
#   "reason": "Payment verified",
#   "actor_user_id": "...",
#   "actor_type": "USER",
#   "created_at": "2026-09-24T12:30:00Z"
# }]
```

**Checklist:**
- [ ] Every transition creates order_status_history entry
- [ ] Entry includes: previous status, new status, reason, actor, timestamp
- [ ] Actor type is 'USER' (manual) or 'SYSTEM' (cascade)
- [ ] Generic audit_logs table also contains entry (entity_type='order')
- [ ] History is immutable (append-only)
- [ ] Pagination works (max 50 entries per page)

---

## Phase 3: State Machine Logic Testing

### 3.1 Valid Transitions (Happy Path)

**Test:** bKash order successful flow

```bash
# 1. Create order (initial: PENDING_CONFIRMATION, PENDING_VERIFICATION)
# (Order creation API not yet implemented, assuming order exists)

# 2. Verify payment
curl -X POST http://localhost:4000/api/admin/orders/:id/payments/verify \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bkashTransactionId": "ABC123"}'

# Expected: 200 OK
# { "order_status": "PENDING_CONFIRMATION", "payment_status": "PAID_VERIFIED" }

# 3. Confirm order
curl -X POST http://localhost:4000/api/admin/orders/:id/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'

# Expected: 200 OK
# { "order_status": "CONFIRMED", "payment_status": "PAID_VERIFIED" }

# 4. Start processing
curl -X POST http://localhost:4000/api/admin/orders/:id/processing \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'

# Expected: 200 OK
# { "order_status": "PROCESSING" }

# 5. Shipment delivered (triggers cascade)
# (Would call shipment endpoint once implemented)
# Expected: order_status → DELIVERED (atomic)
```

**Checklist - bKash Flow:**
- [ ] PENDING_CONFIRMATION + PENDING_VERIFICATION (initial)
- [ ] PENDING_VERIFICATION → PAID_VERIFIED (verify payment)
- [ ] PENDING_CONFIRMATION → CONFIRMED (after payment verified)
- [ ] CONFIRMED → PROCESSING (start processing)
- [ ] PROCESSING → DELIVERED (shipment cascade)
- [ ] History shows all 4 transitions

**Checklist - COD Flow:**
- [ ] COD_VERIFICATION_PENDING + PENDING_COLLECTION (initial)
- [ ] COD_VERIFICATION_PENDING → CONFIRMED (admin confirms, no payment check)
- [ ] CONFIRMED → PROCESSING
- [ ] PENDING_COLLECTION → PAID_COLLECTED (payment collected on delivery)
- [ ] Order can show DELIVERED + PENDING_COLLECTION (valid state, no payment yet)
- [ ] PENDING_COLLECTION → REJECTED (write-off, manual)

### 3.2 Invalid Transitions (Error Cases)

**Test:** All 11 invalid transitions from §5.21.10 are rejected

```bash
# Invalid: PENDING_CONFIRMATION → PROCESSING (must go through CONFIRMED first)
curl -X POST http://localhost:4000/api/admin/orders/:id/processing \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'

# Expected: 409 Conflict
# { "error": "Cannot transition from PENDING_CONFIRMATION to PROCESSING" }
```

**Checklist - Invalid Transitions Rejected (409):**
- [ ] PENDING_CONFIRMATION → PROCESSING
- [ ] PENDING_CONFIRMATION → DELIVERED
- [ ] CONFIRMED → DELIVERED (must go through PROCESSING)
- [ ] DELIVERED → CANCELLED (terminal state)
- [ ] DELIVERED → PENDING_CONFIRMATION
- [ ] CANCELLED → PROCESSING (terminal state)
- [ ] RETURNED → PROCESSING (terminal state)
- [ ] Payment rejection does NOT auto-cancel order (§5.21.2, CRITICAL)
- [ ] Order remains PENDING_CONFIRMATION after payment rejection
- [ ] Admin must manually cancel if needed

### 3.3 Atomic Cascades

**Test:** Shipment → Order transitions are atomic

```bash
# Simulate shipment delivery (would be via courier webhook or manual update)
# Expected:
#   1. Shipment status: OUT_FOR_DELIVERY → DELIVERED
#   2. Order status: PROCESSING → DELIVERED (same transaction)
#   3. Both order_status_history entries created
#   4. Both audit_logs entries created
#   5. If order update fails, shipment update rolls back

# Verify cascade occurred:
curl -X GET http://localhost:4000/api/admin/orders/:id \
  -H "Authorization: Bearer $TOKEN"

# Expected:
# {
#   "order_status": "DELIVERED",
#   "shipment": { "shipment_status": "DELIVERED" }
# }
```

**Checklist:**
- [ ] Shipment DELIVERED triggers Order DELIVERED (same transaction)
- [ ] Shipment RETURNED triggers Order RETURNED (same transaction)
- [ ] Defensive check: order must be PROCESSING, else cascade fails
- [ ] If order update fails, shipment update rolls back
- [ ] No orphaned states (shipment DELIVERED while order PROCESSING)
- [ ] History shows both transitions

### 3.4 Payment-Specific Rules

**Test:** Payment rejection does NOT cancel order (§5.21.2)

```bash
# 1. Order in PENDING_CONFIRMATION, payment in PENDING_VERIFICATION

# 2. Reject payment
curl -X POST http://localhost:4000/api/admin/orders/:id/payments/reject \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"reason": "Invalid screenshot"}'

# Expected: 200 OK
# {
#   "order_status": "PENDING_CONFIRMATION",  // UNCHANGED!
#   "payment_status": "REJECTED"
# }

# ✅ CRITICAL: Order status did NOT change. Admin must manually cancel if needed.
```

**Checklist:**
- [ ] Payment rejection → order status unchanged (still PENDING_CONFIRMATION)
- [ ] bKash can resubmit: REJECTED → PENDING_VERIFICATION
- [ ] COD cannot resubmit (write-off only)
- [ ] DELIVERED + PENDING_COLLECTION is valid (COD not yet paid)
- [ ] DELIVERED + REJECTED is valid (write-off)

---

## Phase 4: Website Integration Testing

### 4.1 Frontend Admin Dashboard (When Implemented)

**Manual Test Steps:**

1. **Login to Admin Panel**
   - Navigate to: `http://localhost:3000/admin/login`
   - Use credentials from your screenshot
   - Should see admin dashboard

2. **Navigate to Orders**
   - Click "Orders" in sidebar
   - Should show paginated list of orders
   - Can filter by: status, payment method, date range

3. **View Order Detail**
   - Click on an order
   - Should show:
     - Order number, customer, amounts
     - Current statuses (order, payment, shipment)
     - Status history timeline
     - Action buttons (confirm, cancel, verify payment, etc.)

4. **Test Order Confirmation**
   - Click "Confirm" button on a PENDING_CONFIRMATION order
   - Modal appears asking for reason (optional)
   - Click confirm
   - Status updates to CONFIRMED
   - History shows new entry

5. **Test Payment Verification**
   - Order in PENDING_CONFIRMATION, payment in PENDING_VERIFICATION
   - Click "Verify Payment"
   - For bKash: form asks for transaction ID
   - For COD: simple "Mark as Paid" button
   - Submit
   - Payment status updates to PAID_VERIFIED/PAID_COLLECTED
   - Order can now be confirmed

6. **Test Payment Rejection**
   - Click "Reject Payment"
   - Form asks for reason (required, min 10 chars)
   - Submit
   - Payment status → REJECTED
   - **CRITICAL:** Order status should still be PENDING_CONFIRMATION (not auto-cancelled)
   - History shows rejection
   - Admin can manually click "Cancel" if needed

### 4.2 Customer Order Tracking (When Implemented)

**Manual Test Steps:**

1. **Customer Views Their Order**
   - Navigate to: `http://localhost:3000/customer/orders`
   - Should see list of their own orders only
   - Can search by order number

2. **View Order Status**
   - Click on an order
   - Should display:
     - Order status with color-coded badge
     - Payment status (if relevant)
     - Shipment tracking (if assigned)
     - Status history timeline (read-only)

3. **bKash Payment Flow (If Customer)**
   - Order in PENDING_CONFIRMATION
   - Show upload form for bKash screenshot
   - After upload, customer sees "Awaiting Admin Verification"
   - Once admin verifies, status updates automatically

---

## Phase 5: Performance & Security Stress Testing

### 5.1 Concurrent Requests (Race Conditions)

**Test:** Multiple admins confirming same order simultaneously

```bash
# Admin A and Admin B both try to confirm order :id at the same time
# Admin A: curl -X POST ... /confirm (succeeds)
# Admin B: curl -X POST ... /confirm (should get 409: already CONFIRMED)

# Expected: Only one succeeds, other gets conflict error
# Guarantees: No double-confirmation, no duplicate history entries
```

**Checklist:**
- [ ] Row locking prevents concurrent status updates on same order
- [ ] Second request gets 409 Conflict (not 500 error)
- [ ] No duplicate history entries
- [ ] Database consistency maintained

### 5.2 Load Testing

**Test:** Handle multiple concurrent order operations

```bash
# Simulate 50 concurrent requests
ab -n 50 -c 10 -H "Authorization: Bearer $TOKEN" \
  -X POST http://localhost:4000/api/admin/orders/:id/confirm

# Expected: All requests complete without timeout
# No 500 errors
# Response time < 1 second per request
```

**Checklist:**
- [ ] 50 concurrent requests complete successfully
- [ ] No timeouts or connection errors
- [ ] No 500 Internal Server Errors
- [ ] Database connections don't leak
- [ ] Memory usage stable

### 5.3 SQL Injection Prevention

**Test:** Malicious input is safely rejected

```bash
# Attempt SQL injection in reason field
curl -X POST http://localhost:4000/api/admin/orders/:id/cancel \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "reason": "Test\"; DROP TABLE orders; --"
  }'

# Expected: 
#   1. Request succeeds (if reason is valid length)
#   2. Reason is stored as literal string (not executed)
#   3. Table still exists
#   4. History shows escaped/safe text
```

**Checklist:**
- [ ] All database queries use parameterized statements
- [ ] Input values never concatenated into SQL strings
- [ ] Special characters in reason field are escaped/stored safely
- [ ] Orders table remains intact after injection attempt

### 5.4 CSRF & XSS Prevention

**Test:** Security headers are present

```bash
curl -I http://localhost:4000/api/admin/orders \
  -H "Authorization: Bearer $TOKEN"

# Expected headers:
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY (or SAMEORIGIN)
# Content-Security-Policy: ...
# Strict-Transport-Security: max-age=...
```

**Checklist:**
- [ ] Security headers present (via helmet.js)
- [ ] No cross-site request forgery vulnerabilities
- [ ] No stored XSS (reason fields escaped)
- [ ] No reflected XSS (error messages don't echo input)

---

## Phase 6: Regression Testing

### 6.1 Existing Features Still Work

**Checklist:**
- [ ] Customer authentication still works
- [ ] Admin authentication still works
- [ ] RBAC still enforces existing permissions
- [ ] Audit logs for other entities (products, managers) still work
- [ ] Catalogue operations still work
- [ ] No regressions in previous specs (01-06)

**Run Full Test Suite:**
```bash
cd backend
npm test  # All tests
npm run test:spec07  # Just Spec 07
npm run test:spec06  # Just RBAC (depends on auth from 01)
```

---

## Phase 7: Final Checklist

### Before Going to Production

- [ ] **Code Review** — All endpoints reviewed for security
- [ ] **Unit Tests** — 51/51 passing
- [ ] **Integration Tests** — All API endpoints tested
- [ ] **Security Tests** — All checklist items verified
- [ ] **Performance Tests** — Load testing passed
- [ ] **Regression Tests** — Existing features still work
- [ ] **Accessibility** — Color-coded badges have text labels too
- [ ] **Documentation** — API documented (Postman collection or OpenAPI)
- [ ] **Error Messages** — User-friendly, no stack traces
- [ ] **Monitoring** — Rate limit rejections logged and alertable

### Deployment Checklist

- [ ] DATABASE_URL is set and points to production DB
- [ ] JWT_SECRET is strong (32+ characters, random)
- [ ] Rate limits configured appropriately for production load
- [ ] Audit logging enabled
- [ ] Error notifications set up (email, Slack, etc.)
- [ ] Backups scheduled and tested
- [ ] HTTPS enforced
- [ ] CORS whitelist set to actual frontend domain (not *)
- [ ] Secrets in environment variables only (no hardcoded)

---

## Test Execution Summary

| Phase | Category | Tests | Status |
|-------|----------|-------|--------|
| 1 | Unit Tests | 51 | ✅ Complete |
| 2 | Authentication | 5+ | ⏳ Ready to test |
| 2 | Input Validation | 8+ | ⏳ Ready to test |
| 2 | Permissions | 7+ | ⏳ Ready to test |
| 2 | Rate Limiting | 5+ | ⏳ Ready to test |
| 2 | Audit Trail | 4+ | ⏳ Ready to test |
| 3 | Valid Transitions | 8+ | ⏳ Ready to test |
| 3 | Invalid Transitions | 11+ | ⏳ Ready to test |
| 3 | Cascades | 5+ | ⏳ Ready to test |
| 3 | Payment Rules | 6+ | ⏳ Ready to test |
| 4 | Frontend Admin | 6+ | ⏳ Ready to test |
| 4 | Frontend Customer | 3+ | ⏳ Ready to test |
| 5 | Concurrent Requests | 3+ | ⏳ Ready to test |
| 5 | Load Testing | 1+ | ⏳ Ready to test |
| 5 | SQL Injection | 1+ | ⏳ Ready to test |
| 5 | CSRF/XSS | 4+ | ⏳ Ready to test |
| 6 | Regression | 5+ | ⏳ Ready to test |
| **TOTAL** | | **100+** | **51 ✅ + 50+ ⏳** |

---

## Commands Quick Reference

```bash
# Run Spec 07 tests
npm run test:spec07

# Run all backend tests
npm test

# Start development server
npm run dev

# Build for production
npm run build

# View test coverage
npm run test:spec07 -- --coverage

# Run specific test
npm run test:spec07 -- --grep="PENDING_CONFIRMATION"
```

---

## Next Steps

1. **Implement API Endpoints** (orders.routes.ts, orders.controller.ts)
2. **Run through Manual Testing Checklist** above
3. **Implement Frontend Pages** (admin dashboard, customer tracking)
4. **Run Regression Tests** (ensure no broken existing features)
5. **Security Audit** (OWASP Top 10)
6. **Load Testing** (under expected production load)
7. **Production Deployment** (with monitoring)

---

**Document Version:** 1.0  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  
**Owner:** Spec 07 Implementation Team
