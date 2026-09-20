# Requirements — Payment and Order Confirmation

> Part of the requirements set — see [01-overview.md](01-overview.md) for the index. Authoritative order-status enum/transitions live in [07-order-state-machine.md](07-order-state-machine.md) (Section 5.21) — this file's status tables are illustrative/UI-facing.

## 3. Payment and Order Confirmation

The platform will support two payment methods during checkout:

1. **bKash Send Money**
2. **Cash on Delivery (COD)**

The customer must select one of these payment methods before placing the order. This applies identically whether the customer is a registered, logged-in customer or a guest (Section 2.9) — both payment methods, and everything in this file, work the same way for guest orders as for registered-customer orders.

Before an order is created, the backend must re-run the checkout validation defined in section 2.3, branching by whether the request is from a registered, logged-in customer or a guest:

- **Registered customer:** re-run the profile-completeness check (Section 2.3, registered path). An order record must not be created if required customer profile information is missing, regardless of what the frontend allowed the customer to submit.
- **Guest:** re-run the guest checkout field validation (Section 2.3, guest path; Section 2.9.3). An order record must not be created if any required guest field (Section 2.9.2) is missing or invalid, regardless of what the frontend allowed the guest to submit.

In both cases the order is created in the same orders table using the same fields and the same state machine (Section 5.21) — only the pre-order validation source (saved profile vs. submitted guest fields) differs.

**Order creation is a single database transaction.** The full sequence — re-running checkout validation (above), re-checking cart contents and current product prices, revalidating and recalculating any applied coupon (Section 8.15b, [10-coupon-discount.md](10-coupon-discount.md)), and inserting the order record — executes inside one database transaction. If any step fails, the transaction rolls back and no order record is created. This guarantee is what allows the coupon system's atomic usage-count update and `coupon_usages` insert (Section 8.25) to be performed as part of the same transaction as the order insert, so an order is never left without its corresponding coupon-usage record (or vice versa) if the request fails or crashes partway through.

If a coupon was applied at checkout, the backend must also revalidate and recalculate the coupon discount as part of this same pre-order validation step, per Section 8.15b ([10-coupon-discount.md](10-coupon-discount.md)) — order creation never trusts a previously-computed discount or total.

The system will maintain separate **Payment Status**, **Order Status**, and **Shipment Status** so that payment verification, order confirmation, shipment creation, and delivery progress can be tracked independently.

---

### 3.1 bKash Send Money

If the customer selects **bKash Send Money**, the checkout page will display the merchant's bKash receiving number and payment instructions, for the server-computed order total after any applied coupon discount (Section 8.16a, [10-coupon-discount.md](10-coupon-discount.md)).

The customer will:

1. Select **bKash Send Money** as the payment method.
2. Place the order.
3. Send the required payment amount to the merchant's bKash number.
4. Enter the **bKash Transaction ID** and/or upload a payment screenshot.
5. Submit the payment information.

Order placement and payment-information submission must be idempotent: a repeated submission of the same request (e.g. from a double-click or a network retry) must not create duplicate orders or duplicate payment records. This is enforced via a client-generated idempotency key (e.g. a UUID generated once per checkout attempt) sent with the order-placement request; the backend treats a repeated request carrying the same key as the same attempt and returns the original result rather than creating a new order.

The submitted **bKash Transaction ID** must be unique across all orders. The backend must reject a Transaction ID that has already been recorded against another order, since this is a required fraud check against reused or resubmitted transaction proofs.

After submission, the order will appear in the **Admin / Manager Order Panel**.

The payment will have the following status:

**Payment Status: `Pending Verification`**

The order will have:

**Order Status: `Pending Confirmation`**

The Admin or Manager will:

1. Review the order details.
2. Check the submitted Transaction ID and/or payment screenshot.
3. Contact the customer manually if additional confirmation is required.
4. Verify the payment.
5. Update the payment status to **Paid / Verified**.
6. Confirm the order.
7. Update the order status to **Confirmed**.
8. Process the order for shipment.
9. Select the preferred courier service.
10. Create the shipment through the available courier API integration.
11. Receive and store the courier's **Parcel ID / Tracking ID**.
12. Hand over the parcel to the courier.
13. Update the shipment status to **Shipped**.

A registered customer will be able to view the updated order and shipment information from their account (Section 2.6); a guest will be able to view the same information via the guest order lookup (Section 2.9.5–2.9.6) or via the public Track Order page once the courier tracking ID is available (Section 4.14).

### bKash Flow

```text
Customer Places Order
        ↓
Payment Status: Pending Verification
        ↓
Customer Sends Money to Merchant bKash
        ↓
Customer Submits Transaction ID / Screenshot
        ↓
Admin / Manager Reviews Payment
        ↓
   ┌───────────────┐
   │               │
Verified        Rejected
   ↓               ↓
Payment Paid    Payment Rejected
/ Verified          ↓
   ↓            Resubmit Payment
Order Confirmed     Information
   ↓
Processing
   ↓
Create Courier Shipment
   ↓
Parcel / Tracking ID Received
   ↓
Shipment Created
   ↓
Parcel Handed to Courier
   ↓
Shipment: Shipped
```

---

### 3.2 Cash on Delivery

If the customer selects **Cash on Delivery (COD)**, the system will display a confirmation message informing the customer that a customer-care representative will contact them to verify the order. The COD amount referenced throughout this section is the server-computed order total after any applied coupon discount (Section 8.16b, [10-coupon-discount.md](10-coupon-discount.md)).

Example:

> **Your order has been received. Our customer-care representative will call you shortly to confirm your order.**

The order will appear in the **Admin / Manager Order Panel** with:

**Order Status: `COD Verification Pending`**

For COD orders, payment does not need to be verified before shipment because payment will be collected by the courier during delivery.

The Admin or Manager will:

1. Review the customer's order and delivery information.
2. Contact the customer manually by phone.
3. Confirm the order with the customer.
4. Update the order status to **Confirmed**.
5. Process the order for shipment.
6. Select the preferred courier service.
7. Create the shipment through the courier API integration.
8. Send the required customer, delivery, and COD amount information to the courier.
9. Receive and store the courier's **Parcel ID / Tracking ID**.
10. Hand over the parcel to the courier.
11. Update the shipment status to **Shipped**.

For COD orders:

**Payment Status: `Pending Collection`**

After successful delivery and payment collection (automatically updated by the courier API or manually by Admin/Manager when courier confirms payment):

**Payment Status: `Paid / Collected`**

### COD Flow

```text
Customer Places Order
        ↓
Order Status: COD Verification Pending
        ↓
Admin / Manager Calls Customer
        ↓
   ┌────────────────────┐
   │                    │
Customer Confirms    Customer Does Not Confirm
   ↓                    ↓
Order Confirmed       Order Cancelled
   ↓
Processing
   ↓
Create Courier Shipment
   ↓
Parcel / Tracking ID Received
   ↓
Shipment Created
   ↓
Parcel Handed to Courier
   ↓
Shipment: Shipped
   ↓
In Transit
   ↓
Out for Delivery
   ↓
Delivered
   ↓
Payment Collected
   ↓
Payment Status: Paid / Collected
```

---

### 3.3 Order Confirmation Flow

The two payment methods use different confirmation processes but share the same overall order and shipment lifecycle.

```text
                         Checkout
                            ↓
                  Select Payment Method
                     ↙             ↘
                    ↙               ↘
          bKash Send Money      Cash on Delivery
                  ↓                    ↓
             Place Order          Place Order
                  ↓                    ↓
       Payment Verification     COD Verification
             Pending                Pending
                  ↓                    ↓
          Submit Transaction      Admin / Manager
          ID / Screenshot         Calls Customer
                  ↓                    ↓
          Admin / Manager       Customer Confirms
          Checks Payment              ↓
                  ↓              Order Confirmed
           ┌──────┴──────┐             ↓
           ↓             ↓        Processing
       Verified       Rejected         ↓
           ↓             ↓       Create Shipment
    Payment Paid     Resubmit          ↓
     / Verified       Payment     Parcel / Tracking ID
           ↓             ↓             ↓
     Order Confirmed     └──────→  Shipment Created
           ↓                           ↓
      Processing                   Shipped
           ↓                           ↓
      Create Shipment             In Transit
           ↓                           ↓
   Parcel / Tracking ID          Out for Delivery
           ↓                           ↓
   Shipment Created              Delivered
           ↓
        Shipped
           ↓
      In Transit
           ↓
   Out for Delivery
           ↓
       Delivered
```

The system will maintain separate statuses for:

- **Payment**
- **Order**
- **Shipment**

This allows each part of the order lifecycle to be tracked independently.

---

### 3.4 Failed Payment Handling

For **bKash Send Money** orders, payment verification is handled separately from order confirmation.

If the submitted payment information cannot be verified, the Admin or Manager may mark the payment as:

**Payment Status: `Rejected`**

Possible reasons include:

- Invalid Transaction ID
- Transaction ID does not match the order
- Payment amount is incorrect
- Payment could not be verified
- Payment screenshot is unclear or invalid
- Customer did not complete the payment

When a payment is rejected:

1. Payment status is updated to **Rejected**.
2. The order remains **Unconfirmed**.
3. The customer is notified that the payment could not be verified.
4. The customer may resubmit the correct Transaction ID or payment information.
5. The Admin or Manager can review the updated information.
6. The order can only move to **Confirmed** after the payment has been successfully verified.

The customer has the opportunity to resubmit payment information multiple times. The Admin or Manager may cancel the order if:

- The customer does not resubmit payment within a reasonable timeframe (business-defined, typically 24-48 hours)
- The customer does not attempt to correct the payment after multiple rejections
- The Admin or Manager determines the order should be cancelled per business rules

This "reasonable timeframe" is enforced manually: the Admin/Manager Order Panel surfaces stale unconfirmed orders (e.g. a filter/sort by time since rejection or since placement) for the Admin/Manager to review and cancel at their discretion. This is not an automatic/scheduled cancellation — no background job cancels orders on a timer.

For **COD orders**, there is no payment verification failure during checkout because payment is collected during delivery.

If the customer refuses the order or the courier cannot collect the COD payment, the shipment may be marked as **Delivery Failed** or **Returned**, depending on the actual courier outcome.

---

### 3.5 Order and Shipment Failure Handling

Shipment creation failures must be handled separately from payment verification and order confirmation.

If the selected courier fails to create a shipment:

1. Record the shipment creation failure.
2. Display the error in the Admin / Manager Order Panel.
3. Keep the order as **Confirmed** or **Processing**.
4. Allow the Admin or Manager to retry shipment creation.
5. Allow the Admin or Manager to select another available courier.
6. Prevent the shipment from being marked as **Shipped** until shipment creation is successful and the parcel has been handed over to the courier.

Example:

```text
Order Confirmed
      ↓
Processing
      ↓
Select Courier
      ↓
Create Shipment
      ↓
   ┌──────────────┐
   │              │
 Success        Failed
   ↓              ↓
Shipment       Creation Failed
Created            ↓
   ↓           Retry / Change Courier
Shipped             ↓
               Create Shipment
```

A courier API failure must not automatically:

- Reject a verified bKash payment
- Cancel a confirmed order
- Mark an order as Shipped

The Admin or Manager must be able to review and retry the shipment creation process.

If a shipment has already been created but delivery later fails, the system will update the shipment status based on the courier's response.

Possible outcomes include:

- Delivery Failed
- Retry Delivery
- Returned

---

### 3.6 Payment Status

Payment status represents the current state of payment for an order.

#### bKash Send Money

```text
Pending Verification
        ↓
Paid / Verified
```

If verification fails:

```text
Pending Verification
        ↓
Rejected
        ↓
Pending Verification (on resubmission)
```

**Note:** "Resubmission" above is not a stored status value — the payment status moves directly from `Rejected` back to `Pending Verification` when the customer resubmits. See the authoritative payment-status rules in Section 5.21.2.

#### Cash on Delivery

```text
Pending Collection
        ↓
Paid / Collected
```

COD payment remains **Pending Collection** until the courier successfully collects the payment from the customer.

---

### 3.7 Order Status

Order status represents the business lifecycle of the order.

The main order statuses, shown here as display labels, are:

| Status                     | Description                                            |
| -------------------------- | ------------------------------------------------------ |
| `Pending Confirmation`     | Order has been placed but has not yet been confirmed.  |
| `COD Verification Pending` | COD order is waiting for manual customer confirmation. |
| `Confirmed`                | Admin / Manager has confirmed the order.               |
| `Processing`               | Order is being prepared for shipment.                  |
| `Cancelled`                | Order has been cancelled.                              |
| `Delivered`                | Customer has received the order successfully.          |
| `Returned`                 | Order has been returned to the store/seller.           |

These are UI display labels only. The authoritative, enforced status enum and transition rules are defined in Section 5.21 (Exact Order Status Transitions) — implementation must follow that section, not this table.

For implementation, **payment and shipment states should not be stored as the primary order status**. They should be maintained separately.

---

### 3.8 Shipment Status

Shipment status represents the delivery progress handled by the selected courier.

| Status             | Description                                        |
| ------------------ | -------------------------------------------------- |
| `Not Created`      | No courier shipment has been created yet.          |
| `Creating`         | System is currently creating the courier shipment. |
| `Created`          | Courier shipment has been successfully created.    |
| `Shipped`          | Parcel has been handed over to the courier.        |
| `In Transit`       | Parcel is moving through the courier network.      |
| `Out for Delivery` | Courier is attempting final delivery.              |
| `Delivered`        | Courier has successfully delivered the parcel.     |
| `Creation Failed`  | Courier shipment could not be created.             |
| `Delivery Failed`  | Courier could not complete delivery.               |
| `Returned`         | Parcel has been returned to the store/seller.      |

**Naming convention:** Title Case labels (e.g. `Not Created`, `In Transit`) shown in Sections 3 and 4 are for UI display only. The corresponding enforced enum values used in the database and backend logic are in `SCREAMING_SNAKE_CASE` (e.g. `NOT_CREATED`, `IN_TRANSIT`), as defined starting in Section 5.21. The same mapping applies to order and payment statuses.

---

### 3.9 Relationship Between Payment, Order, and Shipment Status

The system will maintain three separate status fields. Independently of these statuses, the order also stores subtotal, optional coupon discount, shipping, and final total as separate amount fields (Section 8.15c/8.23, [10-coupon-discount.md](10-coupon-discount.md)); an applied coupon discount does not introduce a new status or change any status transition rule in this section.

Example:

```text
Order
├── Payment Status
├── Order Status
└── Shipment Status
```

#### Example — bKash Order

```text
Payment Status: Paid / Verified
Order Status: Processing
Shipment Status: Created
```

Later:

```text
Payment Status: Paid / Verified
Order Status: Processing
Shipment Status: In Transit
```

After delivery:

```text
Payment Status: Paid / Verified
Order Status: Delivered
Shipment Status: Delivered
```

#### Example — COD Order

Before shipment:

```text
Payment Status: Pending Collection
Order Status: Confirmed
Shipment Status: Not Created
```

After shipment creation:

```text
Payment Status: Pending Collection
Order Status: Processing
Shipment Status: Created
```

During delivery:

```text
Payment Status: Pending Collection
Order Status: Processing
Shipment Status: Out for Delivery
```

After successful delivery:

```text
Payment Status: Paid / Collected
Order Status: Delivered
Shipment Status: Delivered
```

---

### 3.10 Order-Status Transition Rules

The system will prevent invalid status transitions.

Important business rules:

1. A **bKash order cannot become Confirmed until the payment has been successfully verified**.
2. A **COD order can become Confirmed after the Admin / Manager manually confirms the customer by phone**.
3. COD orders do not require payment verification before shipment.
4. An order must be **Confirmed** before shipment processing begins.
5. A courier shipment must be successfully created before the shipment can become **Shipped**.
6. The system must not mark a shipment as **Shipped** if courier shipment creation failed.
7. A failed courier API request must not automatically reject a verified bKash payment.
8. A failed courier API request must not automatically cancel a confirmed order.
9. COD payment remains **Pending Collection** until payment is collected.
10. Successful COD delivery can update payment status to **Paid / Collected**.
11. Delivery failure may result in **Retry Delivery** or **Returned**, depending on the courier outcome.
12. Payment status, order status, and shipment status must remain independent but linked to the same order.

### 3.11 Overall Lifecycle

**Note:** The diagrams below show the combined, customer-facing narrative of order + shipment progress. `Shipped`, `In Transit`, and `Out for Delivery` in these diagrams are **shipment**-status values, not order-status values — the order status itself stays `Processing` throughout that span. The authoritative order-status enum and transitions are defined in Section 5.21 (see 5.21.4 specifically for how shipment states map onto order status).

#### bKash

```text
Place Order
    ↓
Payment Verification Pending
    ↓
Payment Verified
    ↓
Order Confirmed
    ↓
Processing
    ↓
Courier Shipment Created
    ↓
Shipped
    ↓
In Transit
    ↓
Out for Delivery
    ↓
Delivered
```

#### COD

```text
Place Order
    ↓
COD Verification Pending
    ↓
Customer Confirms
    ↓
Order Confirmed
    ↓
Processing
    ↓
Courier Shipment Created
    ↓
Shipped
    ↓
In Transit
    ↓
Out for Delivery
    ↓
Delivered
    ↓
Payment Collected
```

The system will prevent invalid status transitions and ensure that payment verification, order confirmation, shipment creation, and delivery progress are handled as separate but connected processes.
