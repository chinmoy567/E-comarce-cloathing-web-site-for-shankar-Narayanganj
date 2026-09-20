# Requirements — Courier and Shipment Management

> Part of the requirements set — see [01-overview.md](01-overview.md) for the index. Authoritative order/shipment-status enum and transitions live in [07-order-state-machine.md](07-order-state-machine.md) (Section 5.21).

## 4. Courier and Shipment Management

**Note:** Throughout this section, diagrams and examples showing `Shipped`, `In Transit`, `Out for Delivery` (and similar) alongside order progress are describing **shipment**-status values, not order-status values. The order status remains `Processing` while the shipment moves through these states. See Section 5.21 (especially 5.21.4) for the authoritative order-status enum and its relationship to shipment status.

The system will support shipment processing through courier services such as **Pathao** and **Steadfast**.

The courier system will be integrated with the e-commerce platform so that the Admin or Manager does **not need to manually copy and paste customer or order information** into the courier service portal.

After an order has been confirmed, the Admin or Manager will select the preferred courier service and initiate shipment creation. The system will automatically send the required customer and order information to the selected courier through the available **courier API integration**.

---

### 4.1 Courier Selection

After confirming an order, the Admin or Manager will be able to select a courier service from the available options, such as:

- **Pathao**
- **Steadfast**

The selected courier will be associated with the shipment for that order.

Example:

```text
Order #ORD-1025

Order Status: Confirmed

Courier Service:
[ Pathao ▼ ]

        [ Create Shipment ]
```

---

### 4.2 Automatic Customer and Order Information Transfer

When the Admin or Manager clicks **Create Shipment**, the system will automatically retrieve the required information from the order database and submit it to the selected courier's API.

The system may send information such as:

- Customer name
- Customer mobile number
- Delivery address
- Division
- District
- Upazila / Thana (per the customer's stored address, Section 2.2)
- Union / Ward (per the customer's stored address, Section 2.2)
- Postal code where required
- Order reference
- Product information where required
- Order amount
- COD amount for COD orders
- Parcel weight
- Delivery instructions
- Other information required by the selected courier

**Order amount and COD amount are the server-computed final order total after any applied coupon discount** (Section 8.16b, [10-coupon-discount.md](10-coupon-discount.md)), never the pre-discount subtotal — this uses the same order-total field already populated by the existing order-creation flow, with no new field introduced for coupons.

The exact field names and format expected by each courier's API are mapped from this internal address model at the courier-adapter layer (Section 4.9); the internal schema is not assumed to be identical to any individual courier's schema.

The Admin or Manager will **not need to manually copy and paste this information** into the courier service.

The workflow will be:

```text
Order Confirmed
       ↓
Admin / Manager Selects Courier
       ↓
Pathao / Steadfast
       ↓
Click "Create Shipment"
       ↓
System Retrieves Order Information
       ↓
System Sends Information to Courier API
       ↓
Courier Creates Shipment
```

---

### 4.3 bKash Order Shipment

For a **bKash Send Money** order, the shipment can be created only after the payment has been successfully verified and the order has been confirmed.

The workflow is:

```text
bKash Payment
      ↓
Payment Verified
      ↓
Order Confirmed
      ↓
Select Courier
      ↓
Create Shipment
      ↓
Customer and Order Details
Automatically Sent to Courier API
      ↓
Shipment Created
      ↓
Parcel ID / Tracking ID Received
      ↓
Order Shipped
```

The bKash Transaction ID is stored in the platform's payment record and remains associated with the order.

---

### 4.4 Cash on Delivery Shipment

For a **Cash on Delivery (COD)** order, the Admin or Manager will manually contact the customer by phone before creating the shipment.

The workflow is:

```text
COD Order Placed
      ↓
COD Verification Pending
      ↓
Admin / Manager Calls Customer
      ↓
Customer Confirms Order
      ↓
Order Confirmed
      ↓
Select Courier
      ↓
Create Shipment
      ↓
Customer and Order Details
Automatically Sent to Courier API
      ↓
Shipment Created
      ↓
Parcel ID / Tracking ID Received
      ↓
Order Shipped
```

For COD orders, the system will send the appropriate **COD amount** to the courier so that the courier can collect the payment from the customer during delivery. This amount is the discounted final total when a coupon was applied (Section 8.16b, [10-coupon-discount.md](10-coupon-discount.md)).

The payment status will remain **Pending Collection** until the payment has been successfully collected. The payment status will be updated to **Paid / Collected** automatically via courier API status synchronization when the courier confirms payment collection, or manually by the Admin/Manager when receiving payment confirmation from the courier.

---

### 4.5 Parcel ID / Tracking ID

After successfully creating a shipment, the selected courier may return a **Parcel ID, Consignment ID, or Tracking ID**.

The system will automatically store the returned identifier against the shipment and order.

For example:

```text
Order #ORD-1025

Courier:
Pathao

Tracking ID:
PTXXXXXXXXXX

Order Status:
Shipped
```

The Admin/Manager will be able to view the courier and tracking information from the order panel.

---

### 4.6 Shipment Status Synchronization

Where supported by the courier API, the system will retrieve shipment-status updates from the selected courier.

The courier's status will be mapped to the platform's internal shipment and order statuses.

For example:

```text
Courier Status
      ↓
Courier API
      ↓
 Backend
      ↓
Status Mapping
      ↓
DB
      ↓
Customer Dashboard
```

The system may display shipment progress such as:

```text
Shipped
   ↓
In Transit
   ↓
Out for Delivery
   ↓
Delivered
```

This allows customers to track their orders from the e-commerce website without manually entering their tracking information on a separate courier website.

Status updates from the courier (whether received via webhook or polling, depending on what the selected courier API supports) may arrive more than once or out of order. The status-mapping step must be idempotent: applying the same courier status update twice, or receiving an older status after a newer one, must not corrupt the stored shipment/order status or duplicate status-history entries.

---

### 4.7 Customer Order Tracking

After a shipment has been created and a Parcel ID / Tracking ID has been received, the customer will be able to view shipment information through any of the following paths, all backed by the same underlying shipment/order record:

- The public **Track Order** page, using the courier-provided Order ID / Tracking ID — available to guest and registered customers alike, with no login required (Section 4.14).
- A registered customer's own account order history (Section 2.6), which shows a **Track Order** action once a shipment exists (Section 4.14.5).
- A guest's order lookup by store Order Number + Phone Number (Section 2.9.5–2.9.6), which also shows shipment status once a shipment exists.

Shipment/courier tracking works identically for guest and registered orders; the courier integration itself has no concept of guest vs. registered, since it only ever operates on the order/shipment record (Section 4.8–4.9).

Example:

```text
Order #ORD-1025

✓ Order Confirmed
✓ Processing
✓ Shipped
✓ In Transit
● Out for Delivery
○ Delivered

Courier:
Pathao

Tracking ID:
PTXXXXXXXXXX

[ Track Order ]
```

The customer will be able to see the latest available shipment status and tracking information associated with their order.

---

### 4.8 Courier Integration Architecture

The courier integration will be handled through the **Node.js / Express backend** rather than directly from the React frontend.

The architecture will be:

```text
                  Admin Panel
                         ↓
                    backend
                         ↓
                  Courier Service
                         ↓
              ┌──────────┴──────────┐
              ↓                     ↓
         Pathao API            Steadfast API
              ↓                     ↓
         Pathao Courier        Steadfast Courier
              ↓                     ↓
              └──────────┬──────────┘
                         ↓
                    Customer
```

Courier API credentials and sensitive authentication information will remain on the backend and will not be exposed to the customer or React frontend.

---

### 4.9 Courier Service Abstraction

The system should use a common courier service layer so that different courier providers can be integrated without changing the core order-management system.

The courier layer will conceptually support operations such as:

```text
Courier Service
      │
      ├── Create Shipment
      ├── Get Shipment Details
      ├── Track Shipment
      └── Cancel Shipment
```

The system can then provide separate implementations for:

```text
Courier Service
      │
      ├── Pathao
      │     ├── Create Shipment
      │     ├── Track Shipment
      │     └── Cancel Shipment
      │
      └── Steadfast
            ├── Create Shipment
            ├── Track Shipment
            └── Cancel Shipment
```

This structure will allow additional courier services to be added in the future without redesigning the complete order-management system. "Pathao" and "Steadfast" in this document's diagrams and UI examples are illustrative of the currently supported couriers, not a hardcoded closed set — the list of available couriers should be data-driven (e.g. a courier registry/configuration) so a third courier can be added without changing a fixed enum of courier names.

Each courier implementation (Pathao, Steadfast, etc.) must conform to the same method contract — same input shape, same return shape — for `Create Shipment`, `Get Shipment Details`, `Track Shipment`, and `Cancel Shipment`. Provider-specific response fields and status values must be normalized into the shared status vocabulary used elsewhere in this document (section 4.12) before being returned to the core order-management system, so the rest of the system never needs to know which courier handled a given shipment.

---

### 4.10 Shipment Workflow

The overall shipment workflow is:

```text
                    Order Confirmed
                          ↓
                Admin / Manager Selects
                    Courier Service
                          ↓
                  Pathao / Steadfast
                          ↓
                   Create Shipment
                          ↓
              System Automatically Sends
             Customer and Order Details
                          ↓
                  Courier API Creates
                       Shipment
                          ↓
               Parcel / Tracking ID
                     Received
                          ↓
                 ID Stored in System
                          ↓
                  Order Status =
                      Shipped
                          ↓
                     In Transit
                          ↓
                  Out for Delivery
                          ↓
                     Delivered
```

The courier and shipment information will be stored separately from payment information while remaining linked to the corresponding order.

This separation allows the platform to manage **bKash Send Money**, **Cash on Delivery**, **Pathao**, and **Steadfast** workflows independently while maintaining a single order-management system.

### 4.11 Shipment Failure Handling

The system will handle shipment-creation and delivery failures separately from payment and order confirmation.

If the selected courier service fails to create a shipment, the system will:

1. Record the shipment-creation failure.
2. Display an appropriate error message in the Admin / Manager Order Panel.
3. Keep the order as **Confirmed** or **Processing**.
4. Allow the Admin or Manager to retry shipment creation.
5. Allow the Admin or Manager to select another available courier service if required.
6. Prevent the order from being marked as **Shipped** until the shipment has been successfully created and the parcel has been handed over to the courier.

Example:

```text id="w7m3k9"
Order Confirmed
       ↓
Select Courier
       ↓
Create Shipment
       ↓
   ┌───────────────┐
   │               │
   ↓               ↓
Success          Failed
   ↓               ↓
Parcel ID       Shipment Error
Received             ↓
   ↓          Retry / Change Courier
Shipped               ↓
                Create Shipment
```

If the courier API is temporarily unavailable, the system will not create a duplicate shipment automatically. The Admin or Manager can retry the operation after reviewing the error.

**Concurrent creation guard:** While a shipment is in the `CREATING` state for an order, that state acts as a lock — a second `Create Shipment` request for the same order (e.g. from a double-click or a page reloaded during a slow courier API call) must be rejected rather than dispatched to the courier API concurrently. The Admin/Manager may only retry once the shipment has settled into `CREATION_FAILED` (or the request may proceed if it is already `CREATED`/beyond, in which case the UI should simply reflect the existing state rather than resubmitting).

If a shipment is successfully created but the courier later reports a delivery problem, the system will update the shipment and order status according to the available courier information.

Possible delivery outcomes include:

- **In Transit**
- **Out for Delivery**
- **Delivered**
- **Delivery Failed**
- **Returned**

If delivery fails, the Admin or Manager may review the shipment and take the appropriate action, such as requesting another delivery attempt, contacting the customer, or handling the returned parcel.

A shipment failure must not automatically change a successfully verified bKash payment to a failed payment. **Payment status and order/shipment status will remain independent.**

---

### 4.12 Payment, Order, and Shipment Statuses

The system will maintain separate statuses for **Payment**, **Order**, and **Shipment**.

This separation ensures that one event does not incorrectly change another part of the order lifecycle.

#### Payment Status

For **bKash Send Money** orders:

```text id="r5k2p8"
Pending Verification
        ↓
Paid / Verified
```

If the submitted payment cannot be verified:

```text id="q9m4t1"
Pending Verification
        ↓
Rejected
        ↓
Pending Verification (on resubmission)
```

**Note:** `Cancelled` is an order-status value (Section 5.21), not a payment-status value — a payment that is never resubmitted may lead the Admin/Manager to cancel the *order* (Section 3.4), but the payment status itself only ever moves between `Pending Verification`, `Paid / Verified`, and `Rejected`. See Section 5.21.2 for the authoritative payment-status rules.

For **Cash on Delivery** orders:

```text id="n6v8c3"
Pending Collection
        ↓
Paid / Collected
```

The payment status represents only the payment condition and does not determine the shipment status.

---

#### Order Status

The order status represents the business lifecycle of the order:

```text id="a3w7k5"
Pending Confirmation
        ↓
Confirmed
        ↓
Processing
        ↓
Shipped
        ↓
Delivered
```

Additional outcomes may include:

```text id="h8p2r6"
Pending Confirmation
        ↓
Cancelled
```

or:

```text id="j4m9s2"
Shipped
    ↓
Delivery Failed
    ↓
Returned
```

---

#### Shipment Status

The shipment status represents the courier-related lifecycle:

```text id="x6q3m8"
Not Created
     ↓
Creating
     ↓
Created
     ↓
Shipped
     ↓
In Transit
     ↓
Out for Delivery
     ↓
Delivered
```

Possible failure states include:

```text id="v2k7n4"
Creating
   ↓
Creation Failed
   ↓
Retry / Change Courier
```

and:

```text id="c5r8p1"
Out for Delivery
       ↓
Delivery Failed
       ↓
Retry Delivery / Returned
```

---

### 4.13 Relationship Between Statuses

The three status groups work independently but are connected through defined business rules.

#### bKash Example

```text id="m7q4x9"
Payment Status
Pending Verification
        ↓
Paid / Verified

Order Status
Pending Confirmation
        ↓
Confirmed
        ↓
Processing

Shipment Status
Not Created
        ↓
Created
        ↓
Shipped
        ↓
In Transit
        ↓
Delivered
```

#### COD Example

```text id="p3n8w5"
Payment Status
Pending Collection
        ↓
Paid / Collected

Order Status
Pending Confirmation
        ↓
Confirmed
        ↓
Processing
        ↓
Shipped
        ↓
Delivered

Shipment Status
Not Created
        ↓
Created
        ↓
Shipped
        ↓
In Transit
        ↓
Delivered
```

The system will enforce valid transitions between these statuses. For example:

- A **bKash** order cannot become **Confirmed** until its payment has been verified.
- A **COD** order can become **Confirmed** after the Admin or Manager manually confirms the customer by phone.
- An order cannot become **Shipped** until the courier shipment has been successfully created.
- A failed courier API request must not mark the order as **Shipped**.
- A shipment failure must not automatically mark a verified bKash payment as **Rejected**.
- A COD order remains **Pending Collection** until payment is collected.
- A successful delivery of a COD order can update the payment status to **Paid / Collected**.
- A delivery failure can move the shipment/order into **Delivery Failed** or **Returned** according to the actual outcome.

---

### 4.14 Public Track Order Feature

The storefront provides a single, clearly-labelled **Track Order** entry point, using the label "Track Order" (not "Track Package," "Track Shipment Only," or "My Order Tracking"), reachable without login by both guest and registered customers.

```text
Guest Customer                         Registered Customer
       ↓                                       ↓
  Track Order                             Track Order
       ↓                                       ↓
Enter Courier Order ID / Tracking ID   Enter Courier Order ID / Tracking ID
       ↓                                       ↓
   Track Shipment                         Track Shipment
```

Registered customers may additionally reach tracking from their account's order history (Section 4.14.5); this does not replace or hide the public Track Order page for them.

#### 4.14.1 Track Order vs. Guest Order Lookup (Section 2.9) — Not the Same Feature

The platform has two distinct customer-facing lookup capabilities that must not be merged or confused:

| | **Track Order** (this section) | **Guest Order Lookup** (Section 2.9.5–2.9.7) |
| --- | --- | --- |
| Identifier required | Courier-provided Order ID / Parcel ID / Tracking ID (Section 4.15) | Store Order Number **and** Phone Number |
| Who can use it | Guest and registered customers | Guest customers (registered customers use their account instead) |
| Requires a courier shipment to exist | Yes — shows a "not yet available" message before that (Section 4.14.4) | No — shows full order/payment status even before a shipment exists |
| What it shows | Shipment/courier status only (Section 4.14.3) | Full order status, payment status, and shipment status when available (Section 2.9.6) |
| Typical source of the identifier | Courier SMS/notification (Section 4.14.2), or order confirmation once available | Order confirmation page/email at checkout |

Both are valid, supported ways for a guest to check on their order. Neither replaces the other. A customer who only has their courier SMS uses Track Order; a customer who wants full order/payment detail, or who has not yet received a courier identifier, uses the guest order lookup (Section 2.9).

#### 4.14.2 Courier SMS / Mobile Notification

The courier may independently send the customer an SMS or mobile notification containing the courier's Order ID / Tracking ID once a shipment is created. The website does not generate this SMS — that is the courier's own notification, sent outside the platform's control — but the website's Track Order page is designed around a customer who arrives with only that identifier in hand:

```text
Customer receives courier SMS
        ↓
Finds Order ID / Tracking ID
        ↓
Opens website
        ↓
Clicks "Track Order"
        ↓
Enters ID
        ↓
Views shipment status
```

No account, login, or password is required at any point in this flow.

#### 4.14.3 Track Order Page and Result

The Track Order page is a simple form:

```text
Track Your Order

Enter your Order ID / Tracking ID

[________________________]

[ Track Order ]

You can find your Order ID or Tracking ID in the SMS sent by the
courier, or on your order confirmation once the shipment has been
created.
```

On a valid identifier, the result displays, at minimum:

- Order ID / Tracking ID
- Courier name
- Shipment status (using the courier statuses normalized per Section 4.9, not invented events)
- Tracking events/history where the courier provides them
- Estimated delivery information where the courier provides it
- Delivery area/address summary where appropriate (not the full detailed address — see Section 4.16)
- A courier tracking link, when the selected courier exposes one

```text
Order Tracking

Order ID: PT123456789
Courier: Pathao
Status: In Transit

Order Confirmed → Shipment Created → Picked Up → In Transit → Out for Delivery → Delivered
```

This is shipment-status information (Section 3.8/4.12), not the internal order-status state machine (Section 5.21) — see Section 4.14.6.

#### 4.14.4 Tracking Before Shipment Creation

If the identifier does not resolve to a shipment yet — most commonly because the customer entered a store Order Number (or another value) before a courier shipment exists — the page must not fabricate a tracking result. It shows a clear, honest message:

```text
Shipment tracking is not available yet.

Your order has been confirmed and is being prepared for shipment.
You will be able to track it once the courier shipment has been created.
```

No fake Tracking ID is generated, and no courier tracking result is shown before a real courier shipment exists. The guest may instead use the Order Number + Phone Number lookup (Section 2.9) to see current order/payment status in the meantime.

#### 4.14.5 Registered Customer — My Orders Integration

A logged-in customer's order detail page (Section 2.6) displays a Track Order action reflecting current shipment availability:

```text
My Account → My Orders → Order #ORD-2026-001025

Shipment: Pathao
Tracking ID: PT123456789
[ Track Order ]
```

or, before a shipment exists:

```text
Shipment: Not yet created
Tracking: Not available yet
```

Clicking **Track Order** here may either navigate to the public Track Order page pre-filled with the stored courier identifier, or render the same tracking result inline — either is acceptable, provided the displayed data matches Section 4.14.3. This is an additional, convenience path; it does not replace the public Track Order page for registered customers, who remain free to use it directly with an identifier received by SMS.

#### 4.14.6 Order Status vs. Shipment Status on the Track Order Page

Track Order surfaces **shipment status** (Section 3.8), not the internal order-status state machine (Section 5.21), which remains the authoritative record of the store's order lifecycle. The two are never merged:

```text
Order Status (internal, Section 5.21): PROCESSING
Shipment Status (courier, this section): IN_TRANSIT
```

Track Order must not introduce new order-status values (e.g. no `TRACKING_PENDING` / `TRACKING_ACTIVE`); shipment availability is derived from the existing shipment record, not from a new order state.

#### 4.14.7 Order Confirmation Reference

After placing an order, the order confirmation (Section 3) shows the customer their store Order Number and, where already available, a Track Order link:

```text
Order Placed Successfully

Order Number: ORD-2026-001025

You can track your shipment once it has been created by the courier.

[ Track Order ]
```

The confirmation must not claim shipment tracking is available before a courier shipment has actually been created (Section 4.14.4).

#### 4.14.8 Track Order Button Placement

The Track Order entry point is part of the main storefront navigation, consistent with the project's existing design system — this requirement does not call for a redesign of the storefront, only for Track Order to be easy to find:

- Header navigation (desktop)
- Mobile navigation/menu
- Footer, where appropriate

The exact route (e.g. `/track-order`) should follow the existing Next.js routing convention already used elsewhere in the storefront rather than a value hard-coded independently of it.

---

### 4.15 Tracking Identifier Terminology

The platform must not treat the following as interchangeable unless a specific courier integration confirms two of them are actually the same value:

```text
Internal Store Order Number   (e.g. ORD-2026-001025 — generated by this platform)
        ≠
Courier Order ID / Parcel ID / Tracking ID   (e.g. PT123456789 — generated/returned by Pathao or Steadfast, Section 4.5)
```

The Track Order page (Section 4.14) is built around the courier-provided identifier, since that is what the courier's own SMS/notification gives the customer and what the courier's Track Shipment API (Section 4.9) accepts. If a future courier integration exposes a single identifier that also happens to double as the store Order Number, that must be documented explicitly as a courier-specific detail rather than assumed to generalize to other couriers.

The shipment record continues to hold the fields already defined by the existing architecture (Section 4.5, 4.9) — `shipment_id`, `order_id`, `courier`, `courier_order_id` / `parcel_id` / `tracking_id`, `shipment_status` — reused as-is for the Track Order lookup; no duplicate identifier fields are introduced.

---

### 4.16 Track Order Endpoint — Security

The Track Order backend endpoint is public (no authentication required) and must be designed with the same care as any other unauthenticated lookup endpoint:

- **Input validation** on the submitted identifier (format/length checks before it is used in any courier or database lookup).
- **Rate limiting and abuse protection** on the endpoint, reusing the same rate-limiting approach already established in Section 2.5/2.9.7 (capped attempts per identifier and per source IP within a time window).
- **Safe, generic error messages.** An unrecognized identifier returns the same generic "tracking information could not be found" response regardless of the underlying reason, and never distinguishes "no such identifier" from "identifier exists but belongs to another order" — the endpoint must not be usable to enumerate valid identifiers:

  ```text
  Tracking information could not be found.

  Please check your Order ID / Tracking ID and try again.
  ```

- **Customer-safe response payload only.** The endpoint returns the normalized, customer-facing tracking model (Section 4.14.3), never a raw courier API response. The following must never appear in the response, regardless of what the backend/courier response or internal data model contains:
  - Admin/manager notes
  - Fraud/risk-check results (Section 7 / 09-fraud-risk-check.md)
  - Internal payment verification notes, payment proof, or full Transaction IDs
  - Courier or platform API credentials
  - Internal database identifiers (e.g. raw primary keys)
  - Full customer contact/address details beyond a delivery-area summary
  - Any authentication or session credential
- **Backend-enforced business rules**, not just frontend hiding — e.g. the "not yet available" response (Section 4.14.4) must come from the backend checking actual shipment existence, not from the frontend choosing not to call the courier API.

This endpoint is separate from, and independently rate-limited from, the guest order-lookup endpoint (Section 2.9.7), since the two accept different identifiers and expose different data shapes.

