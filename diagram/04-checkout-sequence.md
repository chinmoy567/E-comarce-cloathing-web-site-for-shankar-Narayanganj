# 04 - Checkout and Order Lifecycle Sequences

Source: `backend/src/services/checkout.service.ts`, `checkoutPricing.ts`, `orderStatus.service.ts`,
`03-payment-order.md`, `10-coupon-discount.md`, `08-analytics-meta.md`, `09-fraud-risk-check.md`.

Key idea: the browser only sends **what** the customer wants (product ids, quantities, address, coupon code).
The backend recomputes every price, discount, shipping fee and total.

## 1. Price preview (before placing the order)

`POST /api/checkout/validate` uses the same `priceCheckout` function as order placement, so the preview and the
real order cannot disagree. It is advisory only.

```mermaid
sequenceDiagram
    actor C as Customer or Guest
    participant FE as Next.js /checkout
    participant API as Express API
    participant DB as PostgreSQL

    C->>FE: Enter address, coupon, payment method
    FE->>API: POST /api/checkout/validate (lines, district, couponCode)
    API->>DB: Load live prices and stock for each line
    API->>DB: Validate coupon (status, dates, limits, eligibility)
    API->>DB: Resolve shipping zone and current rate for district
    API-->>FE: subtotal, discount, shipping, total, coupon message
    FE-->>C: Show breakdown
```

## 2. Place order

```mermaid
sequenceDiagram
    actor C as Customer or Guest
    participant FE as Next.js
    participant API as Express API
    participant SV as checkout.service
    participant DB as PostgreSQL

    C->>FE: Click Place Order
    FE->>API: POST /api/customer/orders (idempotencyKey, lines, address, BKASH or COD)
    API->>API: Rate limit, validate input
    API->>SV: createOrder
    SV->>DB: BEGIN
    SV->>DB: Find order by idempotencyKey
    alt key already used
        SV-->>API: Return the existing order (no side effects)
    else new order
        alt registered customer
            SV->>DB: Load customer, require complete profile
        else guest
            SV->>DB: Upsert guest customer by phone (never downgrade a REGISTERED one)
        end
        SV->>DB: Re-price lines, apply coupon, add shipping, compute total
        SV->>DB: INSERT order (initial statuses by payment method)
        SV->>DB: INSERT order_items (name and price snapshot)
        opt coupon used
            SV->>DB: Record coupon usage (limit checked atomically)
        end
        SV->>DB: Append order_status_history rows
    end
    SV->>DB: COMMIT
    API-->>FE: order number and summary
    FE-->>C: Order confirmation page
```

Initial statuses:

| Payment | `order_status` | `payment_status` |
| --- | --- | --- |
| bKash | PENDING_CONFIRMATION | PENDING_VERIFICATION |
| COD | COD_VERIFICATION_PENDING | PENDING_COLLECTION |

Stock is **not** decremented at placement. It is decremented at `CONFIRMED` (spec 07 / 5.1).

## 3. Admin handles the order (bKash and COD)

```mermaid
sequenceDiagram
    actor A as Admin or Manager
    participant API as Express API (RBAC checked)
    participant OS as orderStatus.service
    participant DB as PostgreSQL
    participant META as Meta CAPI
    participant RISK as BD Courier risk API

    A->>API: Open order panel
    opt optional fraud check
        A->>API: POST risk check (customer.risk.check)
        API->>RISK: Look up phone history
        RISK-->>API: score and history
        API->>DB: Cache result (one per order)
    end

    alt bKash order
        A->>API: Verify payment (payment.verify)
        API->>DB: payment_status PENDING_VERIFICATION to PAID_VERIFIED
        Note over A,DB: Reject instead: payment REJECTED, order stays PENDING_CONFIRMATION. A resubmission is recorded by Admin or Manager (POST payments/resubmit) and goes back to PENDING_VERIFICATION
    else COD order
        A->>A: Phone customer to confirm
    end

    A->>API: Confirm order (order.confirm or order.cod.confirm)
    API->>OS: confirmOrder
    OS->>DB: BEGIN, lock order
    OS->>DB: Atomic stock check and decrement
    alt not enough stock
        OS-->>API: InsufficientStock, nothing changes
    else ok
        OS->>DB: order_status CONFIRMED, history, audit
        OS->>DB: COMMIT
        OS--)META: Purchase event, fired once after commit
    end
    API-->>A: Updated order
```

## 4. Cancellation

```mermaid
flowchart TD
    A["Admin or Manager cancels<br/>(reason required)"] --> B{"Order status<br/>PENDING, COD_PENDING,<br/>CONFIRMED or PROCESSING?"}
    B -->|"DELIVERED or already final"| X["Rejected"]
    B -->|yes| C{"Shipment CREATED<br/>or later?"}
    C -->|yes| D["Call courier Cancel Shipment"]
    D -->|courier cannot cancel| E["Block or escalate<br/>shipment is never left active silently"]
    D -->|cancelled| F
    C -->|no| F["One transaction:<br/>order CANCELLED + restore stock<br/>+ store reason, actor, time + history"]
```

## 5. Customer-side views

- Registered customers: `/account/orders` and `/account/orders/[orderNumber]`.
- Guests: `/orders/lookup` (order number + phone) and `/track-order` (courier tracking id).
- All order data shown to the customer is read from the backend; status labels are display text for the stored enums.
