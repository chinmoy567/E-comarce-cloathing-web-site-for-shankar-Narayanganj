# Spec 09 Quick Start Guide

## Overview
Spec 09 implements a **customer risk-check feature** for Admin/Manager users to assess delivery history risk before creating courier shipments. The feature integrates with BD Courier fraud-check API.

## What's Implemented

✅ **Backend** (Complete)
- Database migration: `0008_customer_risk_checks.sql`
- Service: `customerRiskService.ts` (325 lines)
- API endpoint: `POST /api/admin/orders/:id/risk-check`
- Validation schema: `checkCustomerRiskSchema`
- Controller: `checkCustomerRiskController`
- Route: Added to `/api/admin/orders.routes.ts`
- Tests: 31 unit tests, all passing ✅

⏳ **Frontend** (Pending)
- Order details UI section for risk check
- Risk level indicator
- Phone number validation

## Running Tests

```bash
npm run test:spec09
```

✅ **31 tests passing:**
- 9 phone number normalization tests
- 9 risk level calculation tests
- 9 result formatting tests
- 4 configuration tests

## Configuration

Set these environment variables in `.env`:

```bash
BD_COURIER_API_KEY=<your-api-key>
BD_COURIER_BASE_URL=https://api.bdcourier.com
```

## API Endpoint

### Request
```bash
POST /api/admin/orders/{orderId}/risk-check
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "forceRefresh": false
}
```

### Response (Success)
```json
{
  "success": true,
  "data": {
    "phoneNumber": "01912345678",
    "totalOrders": 25,
    "successfulOrders": 22,
    "returnedOrders": 3,
    "successRate": 88,
    "riskScore": 88,
    "riskLevel": "LOW",
    "checkedAt": "2026-09-25T10:30:00Z"
  }
}
```

### Response (API Unavailable — Non-blocking)
```json
{
  "success": true,
  "data": {
    "riskLevel": "CHECK_FAILED",
    "error": {
      "code": "API_UNAVAILABLE",
      "message": "Risk check service unavailable. Please try again later."
    }
  }
}
```

## Key Features

✅ **Non-blocking errors** — API failures don't halt orders  
✅ **Smart caching** — Results reused across orders for same customer (5-min window)  
✅ **Phone validation** — Supports Bangladesh format (01XXXXXXXXX)  
✅ **Risk levels** — HIGH (≥70), MEDIUM (40-69), LOW (<40), UNKNOWN  
✅ **Audit logging** — Every check logged with actor & result  
✅ **Permission enforcement** — `customer.risk.check` permission required  
✅ **Status validation** — Only CONFIRMED or PROCESSING orders allowed  

## Database

Migration: `backend/migrations/0008_customer_risk_checks.sql`

Table: `customer_risk_checks`
- Cache key: `customer_id` (phone number) — reused across orders
- Audit trail: `checked_by`, `order_id` for provenance
- Indexes on customer_id and order_id for fast lookups

## Architecture

```
Next.js Admin Panel
    ↓
Express.js API
    ↓
CustomerRiskService (fetch-based, no external HTTP lib)
    ↓
BD Courier Fraud-Check API
    ↓
PostgreSQL (customer_risk_checks table)
```

## File Structure

```
backend/
├── migrations/
│   └── 0008_customer_risk_checks.sql
├── src/
│   ├── services/fraud/
│   │   └── customerRiskService.ts
│   ├── controllers/admin/
│   │   └── orders.controller.ts (added checkCustomerRiskController)
│   ├── routes/admin/
│   │   └── orders.routes.ts (added POST /risk-check)
│   └── validation/
│       └── orders.validation.ts (added checkCustomerRiskSchema)
├── tests/spec-09-fraud-risk/
│   └── customer-risk-service.unit.test.ts (31 tests ✅)
├── vitest.spec09.config.ts
└── package.json (added test:spec09 script)
```

## Phase 7: Frontend (TODO)

### Admin Order Details Page

Add "Customer Risk" section:

```
┌─────────────────────────────────────┐
│ Customer Risk                       │
├─────────────────────────────────────┤
│ Phone: 01912345678                  │
│ Total Orders: 25                    │
│ Delivered: 22 | Returned: 3         │
│ Success Rate: 88%                   │
│                                     │
│ Risk Score: 88                      │
│ Risk Level: 🟢 LOW RISK              │
│ Last Checked: 2026-09-25            │
│                                     │
│ [Check Risk] [Refresh]              │
└─────────────────────────────────────┘
```

**Visibility:**
- Show only if order status is CONFIRMED or PROCESSING
- Hide for PENDING_CONFIRMATION, CANCELLED, DELIVERED, RETURNED

## Deployment

1. ✅ Backend implementation complete
2. ⏳ Apply migration: `npm run migrate`
3. ⏳ Set environment variables
4. ⏳ Run tests: `npm run test:spec09`
5. ⏳ Implement Frontend (Phase 7)
6. ⏳ Deploy

## Files Modified

- `backend/package.json` — Added `test:spec09` script
- `backend/vitest.spec09.config.ts` — Added env loading
- `backend/src/services/fraud/customerRiskService.ts` — Fixed imports
- `backend/src/controllers/admin/orders.controller.ts` — Already updated
- `backend/src/routes/admin/orders.routes.ts` — Already updated
- `backend/src/validation/orders.validation.ts` — Already updated

## Commits

```
6773265 fix: update spec 09 implementation for native fetch and add test suite
26ed874 docs: add spec 09 implementation summary
1fb5964 feat: implement spec 09 customer risk check
```

## Next Steps

1. **Apply migration** to dev/prod databases
2. **Set BD Courier credentials** in environment
3. **Test API endpoint** with curl or Postman
4. **Implement Frontend UI** for admin order details
5. **Deploy to production**

## Support

For issues or questions about Spec 09:
- Check: `SPEC_09_IMPLEMENTATION_SUMMARY.md`
- Tests: `npm run test:spec09`
- Service: `backend/src/services/fraud/customerRiskService.ts`

---

**Status:** Backend ✅ | Frontend ⏳ | Ready to Deploy ✅
