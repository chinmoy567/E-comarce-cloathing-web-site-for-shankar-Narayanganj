# Spec 09 Risk Check API — Testing Guide

## API Endpoint Overview

### Risk Check Endpoint
**URL:** `POST /api/admin/orders/{orderId}/risk-check`  
**Permission Required:** `customer.risk.check`  
**Authentication:** Bearer token (via session cookie)

## Request Format

```json
{
  "forceRefresh": false
}
```

### Parameters
- `forceRefresh` (boolean, optional): 
  - `false` (default): Use cached result if available (5-minute cache)
  - `true`: Bypass cache and fetch fresh data from courier API

## Response Format — Success (200 OK)

```json
{
  "success": true,
  "data": {
    "phoneNumber": "01912345678",
    "totalOrders": 25,
    "successfulOrders": 22,
    "returnedOrders": 3,
    "successRate": 88,
    "riskScore": 45,
    "riskLevel": "MEDIUM",
    "checkedAt": "2026-09-25T10:30:00Z",
    "error": null
  }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `phoneNumber` | string | Customer's phone number (normalized) |
| `totalOrders` | number \| null | Total orders placed by customer |
| `successfulOrders` | number \| null | Orders delivered successfully |
| `returnedOrders` | number \| null | Orders returned/failed |
| `successRate` | number \| null | Percentage of successful deliveries |
| `riskScore` | number \| null | Risk score (0-100) |
| `riskLevel` | string | One of: `LOW`, `MEDIUM`, `HIGH`, `UNKNOWN`, `CHECK_FAILED` |
| `checkedAt` | string | ISO timestamp of when check was performed |
| `error` | object \| null | Error details if check failed |

## Risk Level Mapping

| Risk Score | Risk Level | Color (UI) | Meaning |
|-----------|-----------|-----------|---------|
| 0-39 | LOW | Green | Safe to proceed |
| 40-69 | MEDIUM | Yellow | Review before proceeding |
| 70-100 | HIGH | Red | High caution recommended |
| N/A | UNKNOWN | Gray | No courier history found |
| Failure | CHECK_FAILED | Gray | API call failed |

## Error Responses

### 400 Bad Request — Invalid Order Status
```json
{
  "error": {
    "code": "INVALID_ORDER_STATUS",
    "message": "Risk check only allowed for orders in CONFIRMED or PROCESSING status. Current status: PENDING_CONFIRMATION"
  },
  "requestId": "req-id-123"
}
```

**Allowed Statuses:**
- `CONFIRMED`
- `PROCESSING`

**Not Allowed:**
- `PENDING_CONFIRMATION`
- `COD_VERIFICATION_PENDING`
- `CANCELLED`
- `DELIVERED`
- `RETURNED`

### 404 Not Found — Order or Customer Not Found
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Order abc123 not found"
  },
  "requestId": "req-id-456"
}
```

### 403 Forbidden — Insufficient Permission
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to check customer risk"
  },
  "requestId": "req-id-789"
}
```

### 500 Internal Server Error — Courier API Failure
```json
{
  "success": true,
  "data": {
    "riskLevel": "CHECK_FAILED",
    "error": {
      "code": "API_UNAVAILABLE",
      "message": "Courier API request timed out"
    },
    "checkedAt": "2026-09-25T10:31:00Z"
  }
}
```

**Courier API Failure Types:**
- `API_UNAVAILABLE` — Courier service down or unreachable
- `API_TIMEOUT` — Request exceeded 10-second timeout
- `NO_HISTORY_FOUND` — Customer phone has no delivery history
- `INVALID_RESPONSE` — Courier API returned unexpected format

## Rate Limiting

**Cache Duration:** 5 minutes per customer (by phone number)  
**Cache Key:** `risk_check_{customerId}`  
**Bypass:** Set `forceRefresh: true`

### Example Rate Limit Flow
```
T=00:00 → First check: 01912345678 → Data cached
T=02:00 → Second check: 01912345678 → Returns cached data (not expired)
T=05:01 → Third check: 01912345678 → Fresh API call (cache expired)
T=05:02 → Fourth check: 01912345678 → Returns fresh cached data
T=05:03 → Force refresh: 01912345678 + forceRefresh=true → Fresh API call
```

## Testing Checklist

### Frontend Testing

- [ ] **Orders List Page**
  - [ ] Loads successfully at `/admin/orders`
  - [ ] Shows paginated list (20 items/page)
  - [ ] Displays order columns: #, customer, total, status, payment status, date
  - [ ] Navigate to order details via "View" link

- [ ] **Order Details Page**
  - [ ] Loads at `/admin/orders/{orderId}`
  - [ ] Shows full order information
  - [ ] Shows cancellation info (if status = CANCELLED)
  - [ ] Displays CustomerRiskSection

- [ ] **CustomerRiskSection Component**
  - [ ] Visible for CONFIRMED orders
  - [ ] Visible for PROCESSING orders
  - [ ] Hidden for PENDING_CONFIRMATION orders
  - [ ] Hidden for CANCELLED orders
  - [ ] Hidden for DELIVERED orders
  - [ ] Hidden for RETURNED orders

- [ ] **Check Risk Button**
  - [ ] Shows "Check Risk" button when no data
  - [ ] Shows loading state ("Checking Risk...") during API call
  - [ ] Displays risk data after success
  - [ ] Shows error message on API failure
  - [ ] Shows "Refresh" button after first check

- [ ] **Risk Data Display**
  - [ ] Phone number displays correctly (e.g., "01912345678")
  - [ ] Total Orders shows count
  - [ ] Delivered shows count
  - [ ] Returned shows count
  - [ ] Success Rate shows percentage
  - [ ] Risk Score shows number (or "—" if null)
  - [ ] Risk Level Badge shows with correct color

- [ ] **Risk Level Badge Colors**
  - [ ] LOW → Green background
  - [ ] MEDIUM → Yellow background
  - [ ] HIGH → Red background
  - [ ] UNKNOWN → Gray background
  - [ ] CHECK_FAILED → Gray background

- [ ] **Refresh Button**
  - [ ] Calls API with `forceRefresh: true`
  - [ ] Bypasses 5-minute cache
  - [ ] Shows loading state during refresh
  - [ ] Updates display with fresh data

- [ ] **Permissions**
  - [ ] Admin user sees "Check Risk" button
  - [ ] Manager with permission sees "Check Risk" button
  - [ ] Manager without permission: button hidden or disabled

- [ ] **Error Handling**
  - [ ] Shows user-friendly error message on API failure
  - [ ] Does not block UI
  - [ ] Allows retry via "Check Risk" button
  - [ ] Displays "Try again" suggestion

### Backend Testing

- [ ] **API Endpoint Exists**
  - [ ] `POST /api/admin/orders/{orderId}/risk-check` responds
  - [ ] Requires valid order ID
  - [ ] Requires CONFIRMED or PROCESSING status

- [ ] **Authentication**
  - [ ] Rejects unauthenticated requests (401)
  - [ ] Accepts valid session token (200)

- [ ] **Authorization**
  - [ ] Checks `customer.risk.check` permission (403 if missing)
  - [ ] Only Admin and Manager roles have this permission

- [ ] **Request Validation**
  - [ ] Accepts `forceRefresh: true`
  - [ ] Accepts `forceRefresh: false` or omitted
  - [ ] Rejects invalid order ID (404)
  - [ ] Rejects invalid order status (400)

- [ ] **Database Storage**
  - [ ] Creates `customer_risk_checks` record
  - [ ] Stores: customer_id, order_id, phone_number, provider, risk_score, risk_level
  - [ ] Stores: total_orders, successful_orders, returned_orders, raw_result, checked_at, checked_by

- [ ] **Audit Logging**
  - [ ] Logs action as `CUSTOMER_RISK_CHECK` in audit_logs
  - [ ] Records actor_id, actor_type, resource_type, resource_id
  - [ ] Records changes with risk_result

- [ ] **Rate Limiting**
  - [ ] Caches by customer_id (5-minute window)
  - [ ] Returns cached data within 5 minutes
  - [ ] Fetches fresh data after 5 minutes
  - [ ] `forceRefresh: true` bypasses cache
  - [ ] No infinite caching (data expires)

- [ ] **Error Handling**
  - [ ] Returns 404 for non-existent order
  - [ ] Returns 400 for invalid order status
  - [ ] Returns 403 for missing permission
  - [ ] Returns 500 with error details if courier API fails
  - [ ] Never blocks order or cancels order on risk check failure
  - [ ] Shows CHECK_FAILED status on API errors

## Manual Test Scenarios

### Scenario 1: Successful Risk Check
```
1. Navigate to /admin/orders
2. Click on an order with status = CONFIRMED
3. Scroll to "Customer Risk Check" section
4. Click "Check Risk" button
5. Observe: Loading state → Risk data displays → Refresh button appears
6. Expected: Risk level badge shows with appropriate color
```

### Scenario 2: Cache Validation
```
1. Check risk for order with phone 01912345678
2. Wait 30 seconds
3. Check risk for same customer again
4. Expected: Data loads instantly (cached)
5. Click "Refresh" button
6. Expected: API called (spinner shown), fresh data displays
7. Wait 5 minutes
8. Check risk again (without forceRefresh)
9. Expected: Fresh API call (cache expired)
```

### Scenario 3: Permission Enforcement
```
1. Log in as Manager WITHOUT customer.risk.check permission
2. Navigate to order with CONFIRMED status
3. Expected: No "Check Risk" button visible
4. Login as Admin or Manager WITH permission
5. Expected: "Check Risk" button visible and clickable
```

### Scenario 4: Order Status Filtering
```
For each order status, verify:
- PENDING_CONFIRMATION: Risk section HIDDEN
- CONFIRMED: Risk section VISIBLE
- PROCESSING: Risk section VISIBLE
- COD_VERIFICATION_PENDING: Risk section HIDDEN
- CANCELLED: Risk section HIDDEN
- DELIVERED: Risk section HIDDEN
- RETURNED: Risk section HIDDEN
```

### Scenario 5: API Failure Handling
```
1. Stop or block courier API
2. Click "Check Risk"
3. Expected: Error message ("Risk check unavailable — please try again")
4. Order not cancelled or blocked
5. Retry button available
6. Restart courier API
7. Retry: Should succeed
```

## Database Query Examples

### Check Risk Check Records
```sql
SELECT * FROM customer_risk_checks
WHERE checked_at > NOW() - INTERVAL '1 hour'
ORDER BY checked_at DESC;
```

### View Audit Log
```sql
SELECT * FROM audit_logs
WHERE action = 'CUSTOMER_RISK_CHECK'
ORDER BY created_at DESC
LIMIT 10;
```

### Check Cache Status (last 5 min)
```sql
SELECT customer_id, phone_number, risk_level, checked_at
FROM customer_risk_checks
WHERE checked_at > NOW() - INTERVAL '5 minutes'
GROUP BY customer_id
ORDER BY checked_at DESC;
```

## Known Limitations

1. **BD Courier API Integration**
   - Requires `BD_COURIER_BASE_URL` and `BD_COURIER_API_KEY` in `.env`
   - Without these, service logs warning but continues (returns UNKNOWN)
   - Does not block order flow

2. **Phone Number Format**
   - Must be valid Bangladesh number (11 digits, starts with 01)
   - Non-matching formats return VALIDATION_ERROR

3. **Cache Scope**
   - Per-customer, not per-order
   - Shared across all orders from same customer
   - Intentional: reduce API calls for repeat customers

## Success Criteria

✅ **Phase 7 Frontend Complete when:**
1. Orders list page loads and displays orders
2. Order details page shows order information
3. CustomerRiskSection renders correctly
4. Check Risk button calls API and displays data
5. Risk level badge shows with correct colors
6. Status filtering hides section for invalid statuses
7. Permission checks prevent unauthorized access
8. Error messages display gracefully

✅ **API Integration Complete when:**
1. All 31 backend unit tests pass
2. API endpoint responds to valid requests
3. Rate limiting works (5-minute cache)
4. Audit logging records actions
5. Database stores risk check data
6. Order flow not blocked by risk check failures

## Related Documentation

- `SPEC_09_IMPLEMENTATION_SUMMARY.md` — Full technical details
- `SPEC_09_QUICK_START.md` — Quick reference with examples
- `.claude/project requirment documents/09-fraud-risk-check.md` — Original requirements
