# System Overview

## 1. System Overview

The proposed system is a **Bangladesh-focused fashion and clothing e-commerce platform** designed to support online shopping, product management, order processing, manual payment verification, customer management, analytics, and courier shipment management.

The platform will support integration with courier services such as **Pathao** and **Steadfast** for shipment processing and order delivery.

The system consists of two primary interfaces:

1. **Customer Storefront**
2. **Admin / Manager Back-office**

---

## 1.1 Technology Stack

The following stack is fixed for this project. Implementation must follow it; do not introduce another database or backend framework unless absolutely required.

**Frontend**

- Next.js
- React
- TypeScript (not JavaScript)
- Tailwind CSS

**Backend**

- Node.js
- Express.js
- TypeScript (not JavaScript)
- REST API

**Database**

- PostgreSQL (not MongoDB)
- Supabase as the PostgreSQL database platform

**Storage**

- Supabase Storage for product images and other uploaded files (e.g. bKash payment screenshots)

**SEO** (via Next.js)

- Server-side rendering / static generation where appropriate
- Metadata API
- Dynamic product and category metadata
- Sitemap and robots.txt
- Canonical URLs
- Open Graph metadata
- JSON-LD structured data
- SEO-friendly URLs

The architecture must stay simple, scalable, and suitable for a production clothing e-commerce site — no speculative infrastructure beyond what this stack requires.

---

## 2. Customer Storefront

The customer-facing application allows customers to:

- Register and log in to their accounts.
- Browse products by category.
- Search and filter products.
- View detailed product information.
- Select product variants such as size, colour, age group, and other available options.
- Purchase products across different categories, including:
  - Men's clothing
  - Women's clothing
  - Children's clothing
  - Adult and children's footwear
  - Sneakers
  - Caps
  - Accessories
  - Other fashion products

- Add products to the shopping cart.
- Add products to a wishlist.
- Manage their profile.
- Add and manage delivery addresses.
- Place orders.
- Select the available payment method.
- Make payment using manual **bKash Send Money**.
- Submit the bKash transaction information during or after checkout.
- Receive order-status updates.
- View order history.
- View the current status of an order.
- View courier and Parcel ID information when available.

---

### 2.1 Customer Registration

- Customers must create an account before placing an order.
- Customer registration must require:
  - Mobile phone number
  - Password
- The mobile phone number must be unique.
- A customer cannot create multiple accounts using the same mobile phone number.
- Passwords must never be stored as plain text.
- Passwords must be securely hashed before being stored in the database.

### 2.2 Customer Profile Requirements

Before a customer can place an order, the following information must exist in their profile:

- Full name
- Mobile phone number
- Email address
- Division
- District
- Upazila
- Union
- Detailed address
- Postal code(optional)

The customer's mobile number and complete delivery address must be available before checkout.

### 2.3 Checkout Validation

When a customer attempts to proceed with checkout or place an order, the system must check whether all required customer profile information is available.

**If all required information is complete:**

- Allow the customer to continue with checkout.
- Allow the customer to place the order according to the normal order flow.

**If any required information is missing:**

- Do not allow the customer to place the order.
- Redirect the customer to the Profile page.
- Clearly identify the missing required information.
- Require the customer to complete the missing information.
- After completing the required information, allow the customer to return to checkout and continue the order.

This validation must be enforced on the backend as well as the frontend. Frontend validation alone must never be relied upon for order eligibility.

### 2.4 Customer Login

Customers must log in using:

- Mobile phone number
- Password

After successful authentication, the system must create a secure authenticated customer session.

### 2.5 Forgot Password

Customers must be able to recover their password using their registered email address.

**Password Recovery Flow**

1. Customer selects Forgot Password.
2. Customer enters the email address associated with their account.
3. The system generates a one-time OTP.
4. The OTP is sent to the customer's registered email address.
5. Customer enters the OTP on the website.
6. The system verifies the OTP.
7. If the OTP is valid and has not expired, the customer can create a new password.
8. Customer enters and confirms the new password.
9. The system securely hashes and updates the new password in the database.

**Password Recovery Security**

- OTPs must expire after a limited period.
- Each OTP must be single-use.
- Limit repeated OTP requests.
- Limit incorrect OTP attempts.
- Passwords must never be stored as plain text.
- The system must not expose sensitive account information through error messages.

### 2.6 Customer Profile Management

Customers must be able to:

- View their profile.
- Edit their profile.
- Update their mobile phone number according to the system's verification rules.
- Update their email address according to the system's verification rules.
- Update their delivery address.
- Change their password.
- View their order history.

### 2.7 Admin Account

The system must have an initial administrator account, created via a seed script at first deployment.

Bootstrap credentials (User ID and Password) for this seed account are provided out-of-band and stored in `.secrets/seed-credentials.md` (gitignored, local only) — never in this document or in source control.

The administrator must have access to the administrative system and the permissions required to manage the website.

> **Note:** The admin password must be changed on first login. Seed credentials must never be committed to source control or documentation intended for wider distribution.

### 2.8 Manager Accounts

The administrator can create manager accounts later.

For each manager, the administrator can assign:

- User ID
- Password

Each manager account must be separate from the administrator account.

The administrator is responsible for creating and managing manager accounts.

---

## 3. Payment and Order Confirmation

The platform will support two payment methods during checkout:

1. **bKash Send Money**
2. **Cash on Delivery (COD)**

The customer must select one of these payment methods before placing the order.

The system will maintain separate **Payment Status**, **Order Status**, and **Shipment Status** so that payment verification, order confirmation, shipment creation, and delivery progress can be tracked independently.

---

### 3.1 bKash Send Money

If the customer selects **bKash Send Money**, the checkout page will display the merchant's bKash receiving number and payment instructions.

The customer will:

1. Select **bKash Send Money** as the payment method.
2. Place the order.
3. Send the required payment amount to the merchant's bKash number.
4. Enter the **bKash Transaction ID** and/or upload a payment screenshot.
5. Submit the payment information.

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

The customer will be able to view the updated order and shipment information from their account.

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

If the customer selects **Cash on Delivery (COD)**, the system will display a confirmation message informing the customer that a customer-care representative will contact them to verify the order.

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
Resubmission
        ↓
Pending Verification
```

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

The system will maintain three separate status fields.

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

## 4. Courier and Shipment Management

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
- Upazila / Thana
- Area / Union where applicable
- Postal code where required
- Order reference
- Product information where required
- Order amount
- COD amount for COD orders
- Parcel weight
- Delivery instructions
- Other information required by the selected courier

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

For COD orders, the system will send the appropriate **COD amount** to the courier so that the courier can collect the payment from the customer during delivery.

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

After a shipment has been created and a Parcel ID / Tracking ID has been received, the customer will be able to view shipment information from their account.

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

This structure will allow additional courier services to be added in the future without redesigning the complete order-management system.

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
Resubmission / Cancelled
```

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

## 5. Admin / Manager Back-office

The back-office application provides authorized staff with management, operational, and business-management functionality.

Access to administrative functions will be controlled through **Role-Based Access Control (RBAC)**. Each staff member will only be able to access functions allowed by their assigned role and permissions.

The back-office will provide the following major modules:

- Catalogue Management
- Order Management
- Customer Management
- Content Management
- Analytics
- Staff and Role Management
- Courier and Shipment Management

---

### 5.1 Catalogue Management

Authorized staff with the required permissions can manage the complete product catalogue.

The catalogue management system will support:

- Create products
- Update products
- Delete products
- Create and manage categories
- Create and manage subcategories
- Upload and manage product images
- Manage product sizes
- Manage product colours
- Manage product variants
- Manage age groups such as children and adults where applicable
- Manage product prices
- Manage product stock and inventory
- Control product visibility
- Mark products as **Active**
- Mark products as **Inactive**
- Mark products as **Featured**
- Display **Out of Stock** status where applicable

The catalogue should support different types of fashion products, including:

- Men's clothing
- Women's clothing
- Children's clothing
- Adult footwear
- Children's footwear
- Sneakers
- Caps
- Accessories
- Other fashion products that may be added in the future

The product system should support product variants where necessary.

Example:

```text
Product: Premium T-Shirt

Colour:
- Black
- White
- Navy

Size:
- S
- M
- L
- XL

Variants:
- Black / M
- Black / L
- White / M
- White / L
- Navy / XL
```

Stock should be managed at the appropriate product or variant level.

**Stock decrement timing:** Inventory must be decremented when an order reaches `CONFIRMED` status (i.e. after bKash payment verification, or after COD customer confirmation), not at order placement. This avoids reducing stock for orders that are never confirmed or are rejected/cancelled, which is expected to be a meaningful share of orders given COD's "pending confirmation" step. If cancellation or rejection occurs after `CONFIRMED` (e.g. during `PROCESSING`), the decremented stock must be restored.

---

### 5.2 Order Management

The Order Management module will allow authorized staff to manage orders throughout their lifecycle.

Authorized staff with the required permissions can:

- View newly placed orders
- Receive dashboard notifications for new orders
- View individual order details
- View customer information
- View delivery information
- View ordered products and quantities
- View order amount
- View selected payment method
- Review submitted bKash payment information
- View bKash Transaction ID
- View uploaded payment screenshots
- Verify bKash payment submissions
- Approve or reject bKash payment submissions
- Review payment resubmissions
- Contact customers manually when necessary
- Manage **Payment Verification Pending** orders
- Manage **COD Verification Pending** orders
- Confirm orders
- Cancel orders
- Update order information according to assigned permissions
- Create courier shipments
- Select the courier service
- View shipment information
- View Parcel ID / Tracking ID
- Track shipment progress
- View complete order history

The Order Management module must clearly distinguish between **bKash orders** and **COD orders** because their verification processes are different.

Payment status, order status, and shipment status will be displayed separately.

---

### 5.3 bKash Order Management

For orders placed using **bKash Send Money**, the Admin or Manager must verify the submitted payment before confirming the order.

The Admin / Manager Order Panel should display information such as:

```text
Order #ORD-1025

Customer:
Name: Customer Name
Phone: 01XXXXXXXXX

Delivery Address:
Division: Chattogram
District: Cumilla
Upazila: Example
Address: Customer Address

Payment Method:
bKash Send Money

Transaction ID:
XXXXXXXXXXXX

Payment Screenshot:
[ View Screenshot ]

Payment Status:
Pending Verification

Order Status:
Pending Confirmation

Actions:
[ Payment Verified ] [ Reject Payment ]
```

The Admin or Manager will:

1. Review the order details.
2. Check the Transaction ID.
3. Check the submitted payment amount.
4. Review the payment screenshot if provided.
5. Verify the payment information.
6. Click **Payment Verified** if the payment is valid.
7. The system will update the payment status to **Paid / Verified**.
8. The Admin or Manager can then confirm the order.
9. The order will move to **Confirmed** and can proceed to processing and shipment.

A bKash order must not be confirmed before successful payment verification.

If the payment cannot be verified, the Admin or Manager can reject the payment according to the payment rejection and resubmission rules defined in the system.

---

### 5.4 COD Order Management

For **Cash on Delivery (COD)** orders, payment verification is not required before shipment.

The Admin or Manager must manually contact the customer and confirm the order.

The Order Panel may display:

```text
Order #ORD-1026

Customer:
Name: Customer Name
Phone: 01XXXXXXXXX

Delivery Address:
Division: Chattogram
District: Cumilla
Upazila: Example
Address: Customer Address

Payment Method:
Cash on Delivery

Payment Status:
Pending Collection

Order Status:
COD Verification Pending

Actions:
[ Confirm Order ] [ Cancel Order ]
```

The Admin or Manager will:

1. Review the order and delivery information.
2. Contact the customer manually by phone.
3. Confirm the order with the customer.
4. Click **Confirm Order**.
5. Update the order status to **Confirmed**.
6. Process the order.
7. Select the courier service.
8. Create the courier shipment.

If the customer does not confirm the order, the Admin or Manager may cancel it.

COD payment will be collected by the courier during delivery.

The payment status will remain:

**Pending Collection**

until the payment has been successfully collected.

After successful collection:

**Paid / Collected**

---

### 5.5 Courier and Shipment Management

The back-office will provide courier and shipment management for supported courier services such as:

- **Pathao**
- **Steadfast**

After an order has been confirmed, the Admin or Manager can select the preferred courier and create a shipment.

The system will automatically retrieve the required customer and order information from the database and send it to the selected courier through the available **courier API integration**.

The Admin or Manager should not need to manually copy and paste customer information into the courier system.

Information may include:

- Customer name
- Customer mobile number
- Delivery address
- Division
- District
- Upazila / Thana
- Union / Area where applicable
- Postal code where required
- Order reference
- Product information where required
- Order amount
- COD amount for COD orders
- Parcel weight
- Delivery instructions
- Other information required by the selected courier

Example:

```text
Order #ORD-1025

Order Status:
Confirmed

Payment Status:
Paid / Verified

Courier:
[ Pathao ▼ ]

Shipment Status:
Not Created

[ Create Shipment ]
```

When the Admin or Manager clicks **Create Shipment**:

```text
Select Courier
      ↓
Create Shipment
      ↓
Backend Retrieves Order Data
      ↓
Courier Service Layer
      ↓
Pathao API / Steadfast API
      ↓
Courier Creates Shipment
      ↓
Parcel ID / Tracking ID
      ↓
Store Shipment Information
      ↓
Shipment Status: Created
```

Courier API credentials and sensitive authentication information must remain on the backend and must never be exposed to the React frontend.

---

### 5.6 Shipment Failure Handling

The system will handle courier shipment failures separately from payment verification and order confirmation.

If shipment creation fails:

1. Record the shipment-creation failure.
2. Display the error in the Admin / Manager Order Panel.
3. Keep the order as **Confirmed** or **Processing**.
4. Set the shipment status to **Creation Failed**.
5. Allow the Admin or Manager to retry shipment creation.
6. Allow the Admin or Manager to select another supported courier.
7. Prevent the shipment from becoming **Shipped** until shipment creation is successful and the parcel has been handed over to the courier.

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
Created       Creation Failed
   ↓              ↓
Shipped       Retry / Change Courier
                  ↓
             Create Shipment
```

A courier API failure must not automatically:

- Reject a verified bKash payment
- Cancel a confirmed order
- Mark the shipment as Shipped

---

### 5.7 Customer Management

Authorized staff with the required permissions can manage customer information required for business operations.

Functions may include:

- View registered customers
- View customer profile information
- View customer contact information
- View customer delivery addresses
- View customer order history
- View payment-related information where permitted
- View shipment information
- View customer account status
- Manage customer accounts according to assigned permissions

Sensitive customer information must only be accessible to staff members who have the appropriate permission.

---

### 5.8 Content Management

The back-office will provide CMS functionality for managing storefront content.

Authorized staff with the required permissions can manage:

- Homepage banners
- Promotional sections
- Featured products
- Product categories displayed on the storefront
- Promotional campaigns
- Homepage sections
- Promotional images
- Other configurable storefront content

CMS permissions will be controlled through RBAC.

Staff members without the required permission must not be able to modify restricted website content.

---

### 5.9 Analytics and Business Reports

The back-office will provide business and operational analytics.

The analytics module may include:

#### Sales

- Total sales
- Total revenue
- Sales trends
- Average order value
- Sales by product
- Sales by category

#### Orders

- Total orders
- Pending orders
- Confirmed orders
- Processing orders
- Delivered orders
- Cancelled orders
- Failed orders
- Returned orders

#### Payments

- bKash orders
- COD orders
- Pending bKash verification
- Verified bKash payments
- Rejected bKash payments
- Pending COD collection
- Collected COD payments

#### Products

- Best-selling products
- Product performance
- Product stock
- Out-of-stock products
- Low-stock products
- Category performance

#### Customers

- Total customers
- New customers
- Returning customers
- Customer order statistics

#### Courier and Shipment

- Shipments by courier
- Shipment status statistics
- Delivered shipments
- Failed deliveries
- Returned shipments
- Courier performance information where available

Analytics should respect the permissions assigned to each staff role.

---

### 5.10 Staff and Role Management

The system will use **Role-Based Access Control (RBAC)** to control administrative access.

The role hierarchy is:

```text
Super Admin
     ↓
Admin
     ↓
Manager
     ↓
Staff
```

The initial roles are:

- **Super Admin**
- **Admin**
- **Manager**
- **Staff**

Each role has a defined maximum permission level.

A lower-level role cannot create, modify, delete, or assign permissions to a higher-level role.

The system will maintain separate permissions for:

- Product and catalogue management
- Order management
- Payment management
- Customer management
- Shipment management
- CMS management
- Analytics and reporting
- Staff management
- Role management
- Permission management
- System configuration
- RBAC configuration

---

### 5.11 Role Hierarchy

The administrative role hierarchy is:

```text
Super Admin
     ↓
Admin
     ↓
Manager
     ↓
Staff
```

The hierarchy determines the maximum administrative scope available to each role.

A lower-level role must not:

- Manage a higher-level role
- Create a higher-level role
- Delete a higher-level role
- Modify a higher-level user's permissions
- Grant permissions above its own maximum permission level
- Modify system-wide RBAC configuration unless explicitly authorized

Operational permissions may be assigned independently within the limits of the user's role.

---

### 5.12 Super Admin

The **Super Admin** has the highest level of administrative access and can manage the complete administrative system.

The Super Admin can:

- Create, update, deactivate, and delete Admin accounts
- Create, update, deactivate, and delete Manager accounts
- Create, update, deactivate, and delete Staff accounts
- Manage roles
- Manage permissions
- Manage system configuration
- Manage products and catalogue
- Manage orders
- Verify and reject bKash payments
- Review payment resubmissions
- Manage customers
- Manage CMS content
- Manage courier configuration
- Manage shipments
- View analytics and reports
- View administrative audit logs

The Super Admin can assign permissions to lower-level roles within the limits of the RBAC system.

The Super Admin account itself is protected.

An Admin, Manager, or Staff member cannot:

- Delete the Super Admin
- Modify the Super Admin's role
- Modify the Super Admin's permissions
- Disable the Super Admin account

---

### 5.13 Admin

The **Admin** has high-level administrative and operational access below the Super Admin.

The Admin can:

- Create, update, deactivate, and delete Manager accounts
- Create, update, deactivate, and delete Staff accounts
- Manage products and catalogue
- Manage orders
- Verify bKash payments
- Reject bKash payments
- Review payment resubmissions
- Confirm COD orders
- Manage customers
- Manage CMS content
- Manage courier shipments
- View analytics and reports
- View relevant audit information

The Admin cannot:

- Create, modify, or delete Super Admin accounts
- Modify Super Admin permissions
- Create another Admin account
- Grant themselves Super Admin permissions
- Grant a Manager or Staff member permissions above the Admin's maximum permission level
- Modify system-wide RBAC rules

The Admin can manage **Managers and Staff**, but cannot manage the Super Admin or other Admin accounts.

---

### 5.14 Manager

The **Manager** is primarily responsible for day-to-day business and operational activities.

The Manager can:

- Manage products
- Manage catalogue information
- View and manage orders
- Verify bKash payments
- Reject bKash payments
- Review payment resubmissions
- Confirm COD orders
- Cancel orders according to assigned permissions
- Manage customers required for order processing
- Create courier shipments
- Select couriers
- Track shipments
- View relevant analytics
- Perform other operational functions assigned to the Manager role

The Manager cannot:

- Create Admin accounts
- Delete Admin accounts
- Create Manager accounts
- Delete Manager accounts
- Modify Manager or Admin permissions
- Manage roles
- Modify system-wide RBAC configuration
- Modify Super Admin or Admin accounts
- Grant administrative permissions to other users

Manager permissions are intended primarily for **business operations**, not administrative user management.

---

### 5.15 Staff

Staff members have limited access based on their assigned operational permissions.

A Staff member may be permitted to:

- View orders
- View required customer information
- Prepare orders
- Update permitted order information
- Prepare shipments
- View shipment information
- Perform other assigned operational tasks

Staff members cannot:

- Create or delete Admin accounts
- Create or delete Manager accounts
- Create or delete Staff accounts unless specifically authorized
- Manage roles
- Manage permissions
- Modify RBAC configuration
- Modify system configuration
- Access restricted payment functions unless specifically permitted
- Access restricted administrative functions unless specifically permitted

Staff permissions should follow the **principle of least privilege** and should provide only the access required for the staff member's assigned duties.

---

### 5.16 Permission Hierarchy Rules

The following rules apply to all administrative accounts.

#### Rule 1 — Role Hierarchy

```text
Super Admin
     ↓
Admin
     ↓
Manager
     ↓
Staff
```

A lower-level role cannot manage a higher-level role.

#### Rule 2 — User Management

| Action             | Super Admin | Admin | Manager | Staff |
| ------------------ | ----------: | ----: | ------: | ----: |
| Manage Super Admin |          No |    No |      No |    No |
| Create Admin       |         Yes |    No |      No |    No |
| Update Admin       |         Yes |    No |      No |    No |
| Delete Admin       |         Yes |    No |      No |    No |
| Create Manager     |         Yes |   Yes |      No |    No |
| Update Manager     |         Yes |   Yes |      No |    No |
| Delete Manager     |         Yes |   Yes |      No |    No |
| Create Staff       |         Yes |   Yes |      No |    No |
| Update Staff       |         Yes |   Yes |      No |    No |
| Delete Staff       |         Yes |   Yes |      No |    No |

The Super Admin account is protected from deletion or modification by lower-level roles.

---

### 5.17 Permission Assignment Rules

Permissions will be assigned through the RBAC system.

The following rules must apply:

1. A user cannot grant additional permissions to themselves.
2. A user cannot assign a role above their allowed management scope.
3. A role cannot grant permissions above its defined maximum permission level.
4. Admins can assign permitted operational permissions to Managers and Staff.
5. Super Admin can manage permissions for lower-level roles.
6. Managers cannot manage roles or system-wide permissions.
7. Staff cannot manage roles or permissions.
8. Protected system permissions cannot be modified by lower-level roles.
9. Every permission-changing action must be authorized by the backend.
10. Every permission-changing action should be recorded in the audit log.

Example:

```text
Super Admin
     ↓
Can manage Admin, Manager, and Staff

Admin
     ↓
Can manage Manager and Staff

Manager
     ↓
Can perform assigned operational tasks

Staff
     ↓
Can perform assigned operational tasks
```

Frontend restrictions such as hiding buttons are not sufficient for authorization.

Every protected administrative API endpoint must perform a backend authorization check.

The authorization flow is:

```text
React Admin Panel
        ↓
Authentication Check
        ↓
Role Check
        ↓
Permission Check
        ↓
Backend Authorization
        ↓
Allow / Deny Action
```

---

### 5.18 Administrative Action Rules

Important administrative actions require appropriate permissions.

Examples:

```text
Payment Verification
        ↓
payment.verify

Payment Rejection
        ↓
payment.reject

Payment Resubmission Review
        ↓
payment.review

Order Confirmation
        ↓
order.confirm

Order Cancellation
        ↓
order.cancel

Shipment Creation
        ↓
shipment.create

Courier Management
        ↓
courier.manage

Manager Creation
        ↓
user.manager.create

Manager Update
        ↓
user.manager.update

Manager Deletion
        ↓
user.manager.delete

Staff Management
        ↓
user.staff.manage

Role Management
        ↓
role.manage
```

The backend must verify the required permission before executing the requested action.

If the user does not have the required permission, the API must reject the request.

Example:

```text
Manager attempts to delete Manager
                ↓
Backend checks permission
                ↓
Permission denied
                ↓
Action rejected
```

---

### 5.19 Separation of Operational and Administrative Access

The system will separate **operational permissions** from **administrative permissions**.

Operational permissions include:

- Product management
- Order management
- Payment verification
- COD confirmation
- Customer management
- Shipment creation
- Shipment tracking

Administrative permissions include:

- User management
- Role management
- Permission management
- System configuration
- RBAC configuration

Managers may receive extensive operational permissions without receiving administrative user-management permissions.

This allows Managers to perform day-to-day business operations without being able to modify the administrative structure of the platform.

---

### 5.20 Complete Permission Matrix

The following permission matrix defines the default maximum access scope.

| Permission Area             | Super Admin | Admin |  Manager |    Staff |
| --------------------------- | ----------: | ----: | -------: | -------: |
| Dashboard View              |         Yes |   Yes |      Yes |      Yes |
| Analytics View              |         Yes |   Yes |      Yes | Assigned |
| Audit Log View              |         Yes |   Yes | Assigned |       No |
| Product Create              |         Yes |   Yes |      Yes | Assigned |
| Product Update              |         Yes |   Yes |      Yes | Assigned |
| Product Delete              |         Yes |   Yes |      Yes |       No |
| Category Management         |         Yes |   Yes |      Yes | Assigned |
| Product Image Management    |         Yes |   Yes |      Yes | Assigned |
| Size / Colour Management    |         Yes |   Yes |      Yes | Assigned |
| Variant Management          |         Yes |   Yes |      Yes | Assigned |
| Price Management            |         Yes |   Yes |      Yes | Assigned |
| Inventory Management        |         Yes |   Yes |      Yes | Assigned |
| Product Visibility          |         Yes |   Yes |      Yes | Assigned |
| Order View                  |         Yes |   Yes |      Yes |      Yes |
| Order Update                |         Yes |   Yes |      Yes | Assigned |
| Order Confirmation          |         Yes |   Yes |      Yes | Assigned |
| Order Cancellation          |         Yes |   Yes |      Yes | Assigned |
| bKash Payment View          |         Yes |   Yes |      Yes | Assigned |
| bKash Payment Verification  |         Yes |   Yes |      Yes | Assigned |
| bKash Payment Rejection     |         Yes |   Yes |      Yes | Assigned |
| Payment Resubmission Review |         Yes |   Yes |      Yes | Assigned |
| COD Order Confirmation      |         Yes |   Yes |      Yes | Assigned |
| Customer View               |         Yes |   Yes |      Yes |      Yes |
| Customer Update             |         Yes |   Yes |      Yes | Assigned |
| Shipment View               |         Yes |   Yes |      Yes |      Yes |
| Shipment Creation           |         Yes |   Yes |      Yes | Assigned |
| Courier Selection           |         Yes |   Yes |      Yes | Assigned |
| Shipment Tracking           |         Yes |   Yes |      Yes |      Yes |
| Shipment Retry              |         Yes |   Yes |      Yes | Assigned |
| Change Courier              |         Yes |   Yes |      Yes | Assigned |
| Courier Configuration       |         Yes |   Yes |       No |       No |
| CMS Management              |         Yes |   Yes | Assigned |       No |
| Staff Create                |         Yes |   Yes |       No |       No |
| Staff Update                |         Yes |   Yes |       No |       No |
| Staff Delete                |         Yes |   Yes |       No |       No |
| Manager Create              |         Yes |   Yes |       No |       No |
| Manager Update              |         Yes |   Yes |       No |       No |
| Manager Delete              |         Yes |   Yes |       No |       No |
| Admin Create                |         Yes |    No |       No |       No |
| Admin Update                |         Yes |    No |       No |       No |
| Admin Delete                |         Yes |    No |       No |       No |
| Role Management             |         Yes |    No |       No |       No |
| Permission Management       |         Yes |    No |       No |       No |
| System Configuration        |         Yes |    No |       No |       No |
| RBAC Configuration          |         Yes |    No |       No |       No |

`Assigned` means the permission may be granted only when permitted by the user's role and by the RBAC rules.

The backend must enforce this matrix for every protected API endpoint.

---

### 5.21 Exact Order Status Transitions

The system will enforce a strict order-status transition system.

An order can only move to the next status through an allowed transition.

Payment status and shipment status are maintained separately and must not be treated as replacements for the order status.

The main order statuses are:

```text
PENDING_CONFIRMATION
COD_VERIFICATION_PENDING
CONFIRMED
PROCESSING
DELIVERED
CANCELLED
RETURNED
```

For bKash orders, the initial status is:

```text
PENDING_CONFIRMATION
```

For COD orders, the initial status is:

```text
COD_VERIFICATION_PENDING
```

---

### 5.21.1 bKash Order Status Transitions

A bKash order follows this lifecycle:

```text
PENDING_CONFIRMATION
        ↓
CONFIRMED
        ↓
PROCESSING
        ↓
DELIVERED
```

The complete process is:

```text
Customer Places Order
        ↓
PENDING_CONFIRMATION
        ↓
Payment Verified
        ↓
CONFIRMED
        ↓
Order Processing
        ↓
PROCESSING
        ↓
Shipment Successfully Delivered
        ↓
DELIVERED
```

Required transitions:

| Current Status         | Next Status  | Condition / Trigger                                            |
| ---------------------- | ------------ | -------------------------------------------------------------- |
| `PENDING_CONFIRMATION` | `CONFIRMED`  | bKash payment is verified and Admin/Manager confirms the order |
| `CONFIRMED`            | `PROCESSING` | Order preparation begins                                       |
| `PROCESSING`           | `DELIVERED`  | Courier reports successful delivery                            |
| `PENDING_CONFIRMATION` | `CANCELLED`  | Order is cancelled according to applicable rules               |
| `CONFIRMED`            | `CANCELLED`  | Cancellation is allowed under platform rules                   |
| `PROCESSING`           | `CANCELLED`  | Cancellation is allowed under platform rules                   |
| `PROCESSING`           | `RETURNED`   | Order is returned according to the applicable return process   |

A bKash order cannot move directly from:

```text
PENDING_CONFIRMATION → PROCESSING
```

or:

```text
PENDING_CONFIRMATION → SHIPPED
```

The payment must first be successfully verified and the order must then be confirmed.

---

### 5.21.2 bKash Payment Rejection and Resubmission

Payment rejection does not create a new order status.

The order remains:

```text
Order Status:
PENDING_CONFIRMATION
```

while the payment status changes:

```text
Payment Status:
PENDING_VERIFICATION
        ↓
REJECTED
```

The system must store:

- Rejection reason
- Rejection timestamp
- Rejecting Admin/Manager
- Previous payment submission
- New payment submission when resubmitted

If the customer resubmits payment information:

```text
Payment Status:
REJECTED
        ↓
PENDING_VERIFICATION
```

The customer may submit:

- New Transaction ID
- New payment screenshot
- Updated payment information where required

The previous rejected submission must remain available in the payment history.

If the new payment information is successfully verified:

```text
Payment Status:
PENDING_VERIFICATION
        ↓
PAID / VERIFIED
```

The Admin or Manager can then confirm the order:

```text
Order Status:
PENDING_CONFIRMATION
        ↓
CONFIRMED
```

Complete flow:

```text
Payment Rejected
        ↓
Order remains Pending Confirmation
        ↓
Customer Resubmits Payment
        ↓
Payment Verification
        ↓
Payment Verified
        ↓
Order Confirmed
```

Payment rejection must not automatically cancel the order.

The order may be cancelled separately according to the platform's cancellation rules.

---

### 5.21.3 COD Order Status Transitions

A COD order follows this lifecycle:

```text
COD_VERIFICATION_PENDING
        ↓
CONFIRMED
        ↓
PROCESSING
        ↓
DELIVERED
```

Required transitions:

| Current Status             | Next Status  | Condition / Trigger                                             |
| -------------------------- | ------------ | --------------------------------------------------------------- |
| `COD_VERIFICATION_PENDING` | `CONFIRMED`  | Admin/Manager contacts customer and customer confirms the order |
| `COD_VERIFICATION_PENDING` | `CANCELLED`  | Customer does not confirm or Admin/Manager cancels the order    |
| `CONFIRMED`                | `PROCESSING` | Order preparation begins                                        |
| `PROCESSING`               | `DELIVERED`  | Courier reports successful delivery                             |
| `PROCESSING`               | `CANCELLED`  | Cancellation is allowed under platform rules                    |
| `PROCESSING`               | `RETURNED`   | Order is returned according to the applicable return process    |

A COD order does not require payment verification before it becomes `CONFIRMED`.

The payment remains:

```text
Payment Status:
PENDING_COLLECTION
```

until the courier successfully collects the COD payment.

After successful delivery and collection:

```text
Payment Status:
PAID / COLLECTED
```

**COD collection discrepancy:** It is possible for the courier to report `DELIVERED` while COD collection has not actually been confirmed (e.g. courier marks delivery complete before reconciling cash). In this case, `orderStatus: DELIVERED` and `paymentStatus: PENDING_COLLECTION` may coexist temporarily. This is not an error condition — the Admin/Manager must be able to see this combination flagged in the Order Panel and manually update `paymentStatus` to `PAID / COLLECTED` once collection is confirmed (via courier settlement report or manual follow-up). The system must not auto-assume payment was collected just because delivery succeeded.

---

### 5.21.4 Shipment Status and Order Status Relationship

Shipment status is maintained separately from order status.

The shipment lifecycle is:

```text
NOT_CREATED
      ↓
CREATING
      ↓
CREATED
      ↓
SHIPPED
      ↓
IN_TRANSIT
      ↓
OUT_FOR_DELIVERY
      ↓
DELIVERED
```

Shipment failure states are handled separately:

```text
CREATING
      ↓
CREATION_FAILED
```

and:

```text
OUT_FOR_DELIVERY
      ↓
DELIVERY_FAILED
```

The order status does not change to:

```text
SHIPPED
IN_TRANSIT
OUT_FOR_DELIVERY
```

because these are shipment states.

The order remains:

```text
PROCESSING
```

while the shipment moves through:

```text
CREATED
    ↓
SHIPPED
    ↓
IN_TRANSIT
    ↓
OUT_FOR_DELIVERY
```

When the courier reports successful delivery:

```text
Shipment Status:
OUT_FOR_DELIVERY
        ↓
DELIVERED

Order Status:
PROCESSING
        ↓
DELIVERED
```

This keeps the order lifecycle and courier lifecycle separate.

---

### 5.21.5 Shipment Creation Failure

If courier shipment creation fails:

```text
Shipment Status:
CREATING
        ↓
CREATION_FAILED
```

The order remains:

```text
PROCESSING
```

The system must:

- Store the courier API error
- Store the failure timestamp
- Store the courier used
- Display the failure reason to authorized Admin/Manager users
- Allow shipment retry
- Allow changing the courier
- Keep the order active

Retry flow:

```text
CREATION_FAILED
        ↓
Retry Shipment
        ↓
CREATING
        ↓
CREATED
```

Change-courier flow:

```text
CREATION_FAILED
        ↓
Change Courier
        ↓
CREATING
        ↓
CREATED
```

The order must not be marked as delivered or completed because of a shipment-creation failure.

A shipment creation failure must not automatically change:

```text
Payment Status:
PAID / VERIFIED
```

to:

```text
Payment Status:
REJECTED
```

for a bKash order.

A courier API failure must also not automatically cancel a confirmed order.

---

### 5.21.6 Delivery Failure

If the courier cannot complete delivery:

```text
Shipment Status:
OUT_FOR_DELIVERY
        ↓
DELIVERY_FAILED
```

The order remains:

```text
PROCESSING
```

until the final outcome is known.

The Admin or Manager can handle the failed delivery according to the courier outcome.

#### Retry Delivery

```text
DELIVERY_FAILED
        ↓
Retry Delivery
        ↓
IN_TRANSIT
        ↓
OUT_FOR_DELIVERY
        ↓
DELIVERED
```

The order remains:

```text
PROCESSING
```

until successful delivery.

#### Returned to Store

If the courier returns the parcel:

```text
DELIVERY_FAILED
        ↓
RETURNED
```

The corresponding shipment status becomes:

```text
RETURNED
```

and the order status becomes:

```text
RETURNED
```

The system should store the courier return reason and relevant tracking history.

---

### 5.21.7 Cancellation Transitions

Cancellation must only occur from statuses where cancellation is permitted.

Allowed cancellation transitions include:

```text
PENDING_CONFIRMATION
        ↓
CANCELLED
```

For COD:

```text
COD_VERIFICATION_PENDING
        ↓
CANCELLED
```

Where business rules allow cancellation after confirmation:

```text
CONFIRMED
        ↓
CANCELLED
```

Where business rules allow cancellation during processing:

```text
PROCESSING
        ↓
CANCELLED
```

The system should not allow normal cancellation after successful delivery:

```text
DELIVERED → CANCELLED
```

If a delivered product needs to be returned, it must use the appropriate return process.

Every cancellation should record:

- Cancellation reason
- Cancellation timestamp
- User who cancelled the order
- Previous order status
- Current order status

---

### 5.21.8 Complete Transition Rules

The backend will enforce the following order transitions.

#### bKash

```text
PENDING_CONFIRMATION
        │
        ├──────────────→ CANCELLED
        │
        ↓
   CONFIRMED
        │
        ├──────────────→ CANCELLED
        │
        ↓
   PROCESSING
        │
        ├──────────────→ CANCELLED
        │
        └──────────────→ RETURNED
        │
        ↓
    DELIVERED
```

#### COD

```text
COD_VERIFICATION_PENDING
        │
        ├──────────────→ CANCELLED
        │
        ↓
   CONFIRMED
        │
        ├──────────────→ CANCELLED
        │
        ↓
   PROCESSING
        │
        └──────────────→ RETURNED
        │
        ↓
    DELIVERED
```

#### Shipment

Shipment status is handled independently:

```text
NOT_CREATED
      ↓
CREATING
      ├──────────────→ CREATION_FAILED
      │                      ↓
      │               Retry / Change Courier
      │                      ↓
      └────────────────── CREATING
                             ↓
                          CREATED
                             ↓
                          SHIPPED
                             ↓
                         IN_TRANSIT
                             ↓
                       OUT_FOR_DELIVERY
                         ↙           ↘
                    DELIVERED    DELIVERY_FAILED
                                      ↓
                              Retry / Returned
                                 ↙        ↘
                          IN_TRANSIT     RETURNED
```

---

### 5.21.9 Transition Authorization

Order-status transitions must also follow RBAC permissions.

| Transition                                    | Allowed Actor / Trigger                                   |
| --------------------------------------------- | --------------------------------------------------------- |
| `PENDING_CONFIRMATION → CONFIRMED`            | Admin / Manager after bKash payment verification          |
| `COD_VERIFICATION_PENDING → CONFIRMED`        | Admin / Manager after customer confirmation               |
| `PENDING_CONFIRMATION → CANCELLED`            | Admin / Manager with cancellation permission              |
| `COD_VERIFICATION_PENDING → CANCELLED`        | Admin / Manager with cancellation permission              |
| `CONFIRMED → PROCESSING`                      | Admin / Manager or authorized Staff                       |
| `CONFIRMED → CANCELLED`                       | Authorized Admin / Manager                                |
| `PROCESSING → CANCELLED`                      | Admin / Manager with cancellation permission              |
| `PROCESSING → RETURNED`                       | System / Admin / Manager based on return outcome          |
| `PROCESSING → DELIVERED`                      | System based on successful courier delivery               |
| Shipment `NOT_CREATED → CREATING`             | Admin / Manager or authorized Staff                       |
| Shipment `CREATING → CREATED`                 | System after successful courier API response              |
| Shipment `CREATING → CREATION_FAILED`         | System after failed courier API response                  |
| Shipment `CREATED → SHIPPED`                  | Admin / Manager or authorized Staff after parcel handover |
| Shipment `SHIPPED → IN_TRANSIT`               | System / courier status synchronization                   |
| Shipment `IN_TRANSIT → OUT_FOR_DELIVERY`      | System / courier status synchronization                   |
| Shipment `OUT_FOR_DELIVERY → DELIVERED`       | System / courier status synchronization                   |
| Shipment `OUT_FOR_DELIVERY → DELIVERY_FAILED` | System / courier status synchronization                   |
| Shipment `DELIVERY_FAILED → IN_TRANSIT`       | Admin / Manager retry or courier update                   |
| Shipment `DELIVERY_FAILED → RETURNED`         | System / courier status synchronization                   |

---

### 5.21.10 Invalid Transitions

The backend must reject invalid status transitions.

Examples:

```text
PENDING_CONFIRMATION → DELIVERED       ❌
PENDING_CONFIRMATION → PROCESSING      ❌
PENDING_CONFIRMATION → SHIPPED         ❌
COD_VERIFICATION_PENDING → SHIPPED     ❌
CONFIRMED → DELIVERED                  ❌
PROCESSING → OUT_FOR_DELIVERY          ❌
DELIVERED → CANCELLED                  ❌
```

Valid examples:

```text
PENDING_CONFIRMATION → CONFIRMED       ✓
CONFIRMED → PROCESSING                 ✓
PROCESSING → DELIVERED                 ✓
COD_VERIFICATION_PENDING → CONFIRMED   ✓
PROCESSING → RETURNED                  ✓
```

The backend must validate every status-changing request before updating the database.

A frontend user must not be able to bypass these rules by directly sending an API request.

The backend should return an appropriate authorization or transition-validation error when an invalid request is received.

---

### 5.21.11 Final Status Model

For implementation, the system will maintain three independent status fields:

```text
Order
├── paymentStatus
├── orderStatus
└── shipmentStatus
```

These three fields represent different parts of the order lifecycle.

#### Example — bKash Order

```text
paymentStatus:  PAID / VERIFIED
orderStatus:    PROCESSING
shipmentStatus: IN_TRANSIT
```

This means:

- Payment has been successfully verified.
- The order is being processed.
- The shipment is currently in transit.

#### Example — COD Order

```text
paymentStatus:  PENDING_COLLECTION
orderStatus:    PROCESSING
shipmentStatus: OUT_FOR_DELIVERY
```

This means:

- Payment has not yet been collected.
- The order is being processed.
- The parcel is currently out for delivery.

#### Example — Delivered bKash Order

```text
paymentStatus:  PAID / VERIFIED
orderStatus:    DELIVERED
shipmentStatus: DELIVERED
```

#### Example — Delivered COD Order

```text
paymentStatus:  PAID / COLLECTED
orderStatus:    DELIVERED
shipmentStatus: DELIVERED
```

The backend must maintain these statuses independently and must not overwrite one status field with another.

The system must use the status-transition rules defined above for all order, payment, and shipment state changes.

All status changes should be recorded with:

- Previous status
- New status
- Timestamp
- Triggering user or system process
- Reason where applicable
- Related payment, order, or shipment event

This provides a complete and traceable lifecycle for every order.
