# Spec 07 — Frontend Integration Plan

## Overview

This document specifies the frontend components, pages, and features required for Spec 07 (Order/Payment/Shipment State Machine) integration across customer storefront and admin dashboard.

---

## 1. Customer Pages

### 1.1 Customer Order Status Page

**Route:** `/customer/orders/:orderNumber`

**Purpose:** Allow customers to view order status, payment status, and shipment tracking in real-time.

**Components:**
- Header: Order Number, Order Date, Total Amount
- Status Timeline:
  - Order Status: PENDING_CONFIRMATION → CONFIRMED → PROCESSING → DELIVERED/CANCELLED/RETURNED
  - Payment Status: PENDING_VERIFICATION → PAID_VERIFIED/REJECTED (bKash) or PENDING_COLLECTION → PAID_COLLECTED/REJECTED (COD)
  - Shipment Status: NOT_CREATED → CREATING → CREATED → SHIPPED → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED
- Status History: Detailed timeline showing all transitions, timestamps, and actors
- Payment Form (if applicable):
  - If order in PENDING_CONFIRMATION and payment status is PENDING_VERIFICATION, show bKash payment screenshot upload form
  - If payment status is REJECTED, show "Resubmit Payment" button
- Shipment Tracking:
  - If shipment exists, show courier name, tracking ID, current location
  - Link to courier website for tracking
- Actions:
  - Cancel button (if order in cancelable state: PENDING_CONFIRMATION, CONFIRMED, PROCESSING)
  - Return button (if order DELIVERED and within return window, if applicable)

**Data Fetching:**
```typescript
GET /api/customer/orders/:orderNumber
// Response: order object with status fields + shipment object
```

**Real-time Updates:**
- Polling: Refresh status every 10-30 seconds (configurable)
- Or: WebSocket subscription to order updates (future enhancement)

### 1.2 Customer Orders List

**Route:** `/customer/orders`

**Purpose:** Show customer's order history with filters.

**Components:**
- Search by Order Number
- Filters:
  - Order Status: All, Pending, Processing, Delivered, Cancelled, Returned
  - Payment Status: All, Pending, Paid, Rejected
  - Date Range: Last 7 days, Last 30 days, Custom
- Paginated table:
  - Order Number
  - Date
  - Total Amount
  - Order Status badge (color-coded)
  - Payment Status badge
  - Shipment Status badge
  - Actions: View Details
- Sorting:
  - By Order Date (newest first, default)
  - By Amount
  - By Status

**Data Fetching:**
```typescript
GET /api/customer/orders?page=1&limit=20&order_status=PROCESSING&created_after=2026-09-01
// Response: paginated list of orders
```

---

## 2. Admin Pages

### 2.1 Admin Orders List

**Route:** `/admin/orders`

**Purpose:** Provide admin/manager with full order management dashboard.

**Components:**
- Advanced Filters:
  - Order Status: dropdown, multi-select
  - Payment Status: dropdown, multi-select
  - Payment Method: bKash / COD
  - Date Range: from/to date pickers
  - Customer Phone/Email: search field
  - Order Number: search field
  - Cancellation Reason: text search (for cancelled orders)
- Sorting Options:
  - Order Date (newest/oldest)
  - Total Amount (highest/lowest)
  - Updated At (for pending actions)
- Paginated Table (max 100 per page):
  - Order Number
  - Customer Name/Phone
  - Order Status badge (color-coded)
  - Payment Status badge
  - Payment Method badge
  - Shipment Status badge (if exists)
  - Total Amount
  - Created At
  - Updated At
  - Actions: View Details
- Bulk Actions (future):
  - Select multiple orders
  - Bulk status change
  - Bulk export

**Data Fetching:**
```typescript
GET /api/admin/orders?page=1&limit=50&order_status=PROCESSING&payment_method=BKASH&created_after=2026-09-01
// Response: paginated list + total count for pagination
```

**Access Control:**
- Requires `order.view` permission
- Managers see only their assigned orders (if applicable, TBD per RBAC)
- Admins see all orders

### 2.2 Admin Order Detail & Management

**Route:** `/admin/orders/:id`

**Purpose:** Full order management interface for status transitions, payment verification, and shipment tracking.

**Sections:**

#### 2.2.1 Order Overview Card
- Order Number (unique, display-only)
- Customer Information:
  - Name
  - Phone
  - Email
  - Delivery Address
- Order Dates:
  - Created At
  - Updated At
  - Cancelled At (if applicable)
- Amounts:
  - Subtotal
  - Shipping
  - Coupon Discount (if applicable)
  - Total
  - Display-only fields (not editable on this page; edits happen at checkout/coupon stages)

#### 2.2.2 Order Status Management

**Current Status Display:**
```
Order Status: [badge] PROCESSING
   ↓ Valid Transitions:
   ├─ CANCELLED (requires order.cancel permission)
   ├─ RETURNED (requires order.cancel permission, system-triggered primarily)
   └─ (DELIVERED: triggered by shipment cascade, not manual)
```

**Status Transition Buttons:**
- Color-coded buttons for valid transitions only
- Disabled buttons for invalid transitions with tooltip: "Cannot transition from PROCESSING to X: <reason>"
- Confirmation modal before transition with fields:
  - Reason (required text field)
  - Actor (pre-filled with current user, display-only)
  - Timestamp (auto-filled, display-only)

**Permission Guards:**
- Button visible only if user has required permission (order.confirm, order.cancel, etc.)
- Button disabled if permission missing (with tooltip)

#### 2.2.3 Payment Status Management

**For bKash Orders:**
- Current Status: [badge] PENDING_VERIFICATION
- Valid Transitions:
  - Verify Payment (requires payment.verify):
    - Form: bKash Transaction ID (text input, required)
    - Submit button
    - On success: status → PAID_VERIFIED, auto-collapse form
  - Reject Payment (requires payment.reject):
    - Form: Rejection Reason (textarea, required)
    - Submit button
    - On success: status → REJECTED
    - Note: Order is NOT auto-cancelled (critical spec requirement)
  - Resubmit Payment (if REJECTED, requires payment.review):
    - Form: New bKash Transaction ID (text input, required)
    - Submit button
    - On success: status → PENDING_VERIFICATION

**For COD Orders:**
- Current Status: [badge] PENDING_COLLECTION
- Valid Transitions:
  - Collect Payment (requires payment.verify):
    - Simple button (no form, same as mark-as-paid)
    - Confirmation: "Mark payment as collected?"
  - Write Off Payment (requires payment.reject):
    - Form: Write-off Reason (textarea, required)
    - Confirmation: "This order will show as DELIVERED + REJECTED (unresolved)"
    - On success: status → REJECTED

**Payment History:**
- Timeline showing:
  - PENDING_VERIFICATION → PAID_VERIFIED: timestamp, actor, transaction ID
  - PENDING_VERIFICATION → REJECTED: timestamp, actor, reason
  - REJECTED → PENDING_VERIFICATION: timestamp, actor, new transaction ID
  - etc.

#### 2.2.4 Shipment Management

**Shipment Card:**
- Shipment Status: [badge] CREATED
- Courier: [text or "Not assigned"]
- Courier Order ID / Tracking ID: [text]
- Last Updated: [timestamp]

**Valid Transitions (if user has shipment.create, shipment.track, shipment.retry):**
- Buttons for valid shipment transitions:
  - If NOT_CREATED: "Create Shipment" button (requires shipment.create)
  - If CREATED: "Mark as Shipped" (if applicable, requires shipment.create)
  - If DELIVERY_FAILED: "Retry Delivery" (requires shipment.retry)
  - Status update form (system-triggered updates like IN_TRANSIT, OUT_FOR_DELIVERY are typically via courier webhook; manual override button for testing)

**Courier Tracking:**
- Courier name and logo
- Tracking ID (clickable link to courier website)
- Real-time tracking status (if integrated)
- Estimated delivery date
- Delivery failure reason (if applicable)

#### 2.2.5 Order Status History Timeline

**Timeline View:**
- Reverse chronological (newest first)
- Each entry shows:
  - Status Field: [badge] order_status / payment_status / shipment_status
  - Previous Status → New Status
  - Reason (if provided)
  - Actor: "Admin (email)" or "System"
  - Timestamp
  - Details button (expands to show full entry including audit_logs link)

**Data Fetching:**
```typescript
GET /api/admin/orders/:id/history?page=1&limit=50
// Response: paginated order_status_history entries
```

#### 2.2.6 Action Buttons (Top of Page)

- Edit Address (future, deferred)
- Add Note (future, deferred)
- View Audit Log (link to /admin/audit-logs?order_id=...)
- Resend Email (future)
- Refund (future)
- Cancel Order (shortcut, same as order status → CANCELLED)

**Access Control:**
- All buttons require respective permissions (order.cancel, payment.verify, etc.)
- Manager sees only if assigned to this order

---

## 3. Components & Hooks

### 3.1 Status Badge Component

```typescript
// components/StatusBadge.tsx
interface StatusBadgeProps {
  status: OrderStatus | PaymentStatus | ShipmentStatus;
  type: 'order' | 'payment' | 'shipment';
  size?: 'sm' | 'md' | 'lg';
}

// Returns color-coded badge with status label
// Colors: PENDING (yellow), CONFIRMED/PAID (blue), DELIVERED/COLLECTED (green), CANCELLED/REJECTED (red)
```

### 3.2 Status Timeline Component

```typescript
// components/StatusTimeline.tsx
interface StatusTimelineProps {
  entries: OrderStatusHistoryEntry[];
  isLoading: boolean;
  error?: Error;
}

// Returns timeline of status changes with timestamps and actors
```

### 3.3 Order Status Transition Form Component

```typescript
// components/admin/OrderStatusTransitionForm.tsx
interface OrderStatusTransitionFormProps {
  orderId: string;
  currentStatus: OrderStatus;
  paymentMethod: PaymentMethod;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

// Shows valid transition buttons, handles form submission, error handling
```

### 3.4 Payment Verification Form Component

```typescript
// components/admin/PaymentVerificationForm.tsx
interface PaymentVerificationFormProps {
  orderId: string;
  paymentMethod: PaymentMethod;
  currentPaymentStatus: PaymentStatus;
  onSuccess?: () => void;
}

// For bKash: transaction ID input
// For COD: simple "collect payment" action
```

### 3.5 useOrderDetail Hook

```typescript
// hooks/useOrderDetail.ts
function useOrderDetail(orderId: string) {
  // Fetches order with shipment, handles real-time updates
  // Returns: { order, shipment, status, loading, error, refetch }
}
```

### 3.6 useOrderHistory Hook

```typescript
// hooks/useOrderHistory.ts
function useOrderHistory(orderId: string, page = 1, limit = 50) {
  // Fetches order_status_history entries
  // Returns: { entries, total, loading, error, pagination }
}
```

### 3.7 useOrderList Hook

```typescript
// hooks/useOrderList.ts
interface OrderListFilters {
  orderStatus?: OrderStatus[];
  paymentStatus?: PaymentStatus[];
  paymentMethod?: PaymentMethod;
  createdAfter?: Date;
  createdBefore?: Date;
  page?: number;
  limit?: number;
}

function useOrderList(filters: OrderListFilters) {
  // Fetches orders with pagination and filtering
  // Returns: { orders, total, loading, error, pagination }
}
```

---

## 4. API Client Types & Functions

### 4.1 Update Types (lib/apiTypes.ts)

```typescript
// Enum mirrors from backend
export enum OrderStatus {
  PENDING_CONFIRMATION = 'PENDING_CONFIRMATION',
  COD_VERIFICATION_PENDING = 'COD_VERIFICATION_PENDING',
  CONFIRMED = 'CONFIRMED',
  PROCESSING = 'PROCESSING',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  RETURNED = 'RETURNED',
}

export enum PaymentMethod {
  BKASH = 'BKASH',
  COD = 'COD',
}

export enum PaymentStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  PAID_VERIFIED = 'PAID_VERIFIED',
  REJECTED = 'REJECTED',
  PENDING_COLLECTION = 'PENDING_COLLECTION',
  PAID_COLLECTED = 'PAID_COLLECTED',
}

export enum ShipmentStatus {
  NOT_CREATED = 'NOT_CREATED',
  CREATING = 'CREATING',
  CREATED = 'CREATED',
  SHIPPED = 'SHIPPED',
  IN_TRANSIT = 'IN_TRANSIT',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  CREATION_FAILED = 'CREATION_FAILED',
  DELIVERY_FAILED = 'DELIVERY_FAILED',
  RETURNED = 'RETURNED',
}

export interface Order {
  id: string;
  order_number: string;
  customer_id: string;
  payment_method: PaymentMethod;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  subtotal: number;
  shipping_amount: number;
  coupon_id?: string;
  discount_amount?: number;
  total_amount: number;
  cancellation_reason?: string;
  cancelled_at?: string;
  cancelled_by?: string;
  created_at: string;
  updated_at: string;
}

export interface Shipment {
  id: string;
  order_id: string;
  shipment_status: ShipmentStatus;
  courier?: string;
  courier_order_id?: string;
  courier_error?: string;
  courier_error_at?: string;
  return_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface OrderStatusHistoryEntry {
  id: string;
  order_id: string;
  status_field: 'order_status' | 'payment_status' | 'shipment_status';
  previous_status?: string;
  new_status: string;
  reason?: string;
  actor_user_id?: string;
  actor_type: 'USER' | 'SYSTEM';
  created_at: string;
}
```

### 4.2 API Client Functions (lib/apiClient.ts)

```typescript
// Orders
export async function getOrder(orderId: string): Promise<Order & { shipment?: Shipment }>
export async function listOrders(filters: OrderListFilters): Promise<{ orders: Order[], total: number }>
export async function getOrderHistory(orderId: string, page?: number): Promise<OrderStatusHistoryEntry[]>

// Order Status Transitions
export async function confirmOrder(orderId: string, reason?: string): Promise<Order>
export async function startProcessing(orderId: string): Promise<Order>
export async function cancelOrder(orderId: string, reason: string): Promise<Order>

// Payment Status Transitions
export async function verifyPayment(orderId: string, payload: BkashVerifyPayload | CocdVerifyPayload): Promise<Order>
export async function rejectPayment(orderId: string, reason: string): Promise<Order>
export async function resubmitPayment(orderId: string, newTransactionId: string): Promise<Order>
export async function collectPayment(orderId: string): Promise<Order> // COD

// Shipment Status Transitions
export async function createShipment(orderId: string, courier?: string): Promise<Shipment>
export async function updateShipmentStatus(orderId: string, newStatus: ShipmentStatus): Promise<Shipment>
```

---

## 5. UI/UX Patterns

### 5.1 Color Coding

- **PENDING** (yellow): PENDING_CONFIRMATION, COD_VERIFICATION_PENDING, PENDING_VERIFICATION, PENDING_COLLECTION, CREATING
- **CONFIRMED/ACTIVE** (blue): CONFIRMED, PROCESSING, PAID_VERIFIED, CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY
- **SUCCESS** (green): DELIVERED, PAID_COLLECTED
- **ERROR/REJECTED** (red): CANCELLED, RETURNED, REJECTED, CREATION_FAILED, DELIVERY_FAILED

### 5.2 Validation & Error Messages

- **409 Conflict:** "Cannot transition from {current} to {target}: {reason}". Display with red toast or inline error.
- **422 Unprocessable:** "Validation failed: {details}". Display with field-specific errors.
- **404 Not Found:** "Order not found. Please check the order number and try again."
- **403 Forbidden:** "You don't have permission to perform this action. Contact your administrator."
- **429 Too Many Requests:** "Too many requests. Please wait a few moments and try again."

### 5.3 Loading & Async States

- Show spinner/skeleton while fetching order details
- Disable buttons while request in flight
- Show success toast on successful transition
- Show error toast on failure (with retry button if applicable)

### 5.4 Responsive Design

- Mobile-first: single-column timeline on mobile
- Tablet: two-column layout (status cards + history)
- Desktop: three-column layout (order info + status management + history)
- Status badges and buttons stack vertically on mobile

---

## 6. Security Considerations

### 6.1 Frontend Authorization Boundaries

- **CRITICAL:** Frontend buttons/forms are UI hints only; backend always re-checks permissions
- Never hide status transition buttons based on frontend state alone
- All API calls will fail with 403 if user lacks permission; handle gracefully

### 6.2 Input Validation

- Form fields use Zod schema matching backend validation
- Reason fields: min 10 chars, max 500 chars (examples: "Customer requested cancellation", "Payment screenshot invalid")
- Transaction IDs: min 5 chars, alphanumeric + dashes
- Display validation errors inline on form

### 6.3 CSRF Protection

- All POST/PUT requests include CSRF token (if session-based auth)
- Or: rely on JWT Bearer token (current architecture)

### 6.4 XSS Prevention

- Reason/notes fields rendered as plain text, not HTML
- Use React's built-in escaping (not dangerouslySetInnerHTML)
- Sanitize audit trail actor names if user-supplied

---

## 7. Testing

### 7.1 Component Tests (Vitest + React Testing Library)

- StatusBadge: renders correct color/label per status
- StatusTimeline: displays entries in reverse chronological order
- OrderStatusTransitionForm: shows valid buttons only, submits correct payload

### 7.2 Integration Tests (Playwright)

- Customer order page: fetches and displays order, supports pagination
- Admin orders list: filters by status, payment method, date range
- Admin order detail: transitions order through valid states, shows updated history
- Payment verification: bKash form vs COD simple button, error handling

### 7.3 E2E Tests (Playwright)

- Full flow: customer places bKash order → payment verified → order confirmed → shipment created → delivered
- COD flow: order placed → verified → processing → delivered → payment collected
- Error flow: invalid transition attempt → 409 shown to user → can retry

---

## 8. Implementation Roadmap

### Phase 1: Data Types & API Client
- [ ] Add enums to lib/apiTypes.ts
- [ ] Add interface definitions (Order, Shipment, OrderStatusHistoryEntry)
- [ ] Implement API client functions in lib/apiClient.ts
- [ ] Create custom hooks (useOrderDetail, useOrderHistory, useOrderList)

### Phase 2: Shared Components
- [ ] StatusBadge component
- [ ] StatusTimeline component
- [ ] Status transition confirmation modal

### Phase 3: Customer Pages
- [ ] /customer/orders list page
- [ ] /customer/orders/:orderNumber detail page
- [ ] Payment upload form for bKash

### Phase 4: Admin Pages
- [ ] /admin/orders list page with filters
- [ ] /admin/orders/:id detail page
- [ ] Order status transition UI
- [ ] Payment verification UI
- [ ] Shipment tracking UI

### Phase 5: Testing & Polish
- [ ] Component tests
- [ ] Integration tests
- [ ] E2E tests (full order flow)
- [ ] Accessibility audit
- [ ] Performance optimization

### Phase 6: Production Readiness
- [ ] Real-time WebSocket updates (optional future enhancement)
- [ ] Bulk actions (export, batch status change)
- [ ] Admin notes/comments
- [ ] Return process UI (future spec)

---

## 9. Known Limitations & Future Work

- **Manual Courier Tracking:** Current implementation assumes manual admin entry. Real courier API sync (Pathao, Steadfast) is Spec 4.
- **WebSocket:** Status updates via polling; WebSocket subscription deferred to post-MVP.
- **Bulk Actions:** Selecting multiple orders for batch operations deferred.
- **Return Process:** Full return flow (customer initiates, refund processing) in a future spec.
- **Email Notifications:** Status change email notifications deferred (email service integration).
- **SMS Notifications:** WhatsApp/SMS per Spec 12, not included here.

---

## Notes for Implementation

1. All Spec 07 enums must match backend mirrors exactly (OrderStatus, PaymentStatus, ShipmentStatus, PaymentMethod).
2. Use the API client functions; do not call fetch directly.
3. Always handle 409 and 422 errors gracefully; users expect them for invalid transitions.
4. Test permission checks: frontend button visibility is a UX convenience, not a security boundary.
5. Maintain timezone consistency: all timestamps are UTC from server, format according to user locale on frontend.
6. For COD orders, emphasize the DELIVERED + PENDING_COLLECTION state: explain that customer can still pay or order can be written off.
