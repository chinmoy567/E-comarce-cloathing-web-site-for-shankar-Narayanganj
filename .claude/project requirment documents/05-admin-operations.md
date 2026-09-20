# Requirements — Admin/Manager Operations (Catalogue, Orders, Customers, CMS, Analytics)

> Part of the requirements set — see [01-overview.md](01-overview.md) for the index. RBAC roles/permissions (Sections 5.10–5.19) live in [06-rbac.md](06-rbac.md); the order state machine (Section 5.21) lives in [07-order-state-machine.md](07-order-state-machine.md).

## 5. Admin / Manager Back-office

The back-office application provides Admin and Manager users with management, operational, and business-management functionality.

Access to administrative functions will be controlled through **Role-Based Access Control (RBAC)**. Each Admin or Manager user will only be able to access functions allowed by their assigned role and permissions.

The back-office will provide the following major modules:

- Catalogue Management
- Order Management
- Customer Management
- Content Management
- Marketing / Discounts (Coupon Management — Section 8, [10-coupon-discount.md](10-coupon-discount.md))
- Analytics
- Admin and Manager Account Management
- Courier and Shipment Management

---

### 5.1 Catalogue Management

Authorized Admin/Manager users with the required permissions can manage the complete product catalogue.

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

**Note on product status fields:** `Active` / `Inactive` are mutually exclusive values of a single product visibility status (a product is one or the other, never both). `Featured` is an independent flag that can apply to a product regardless of whether it is Active or Inactive (though only an Active, Featured product should ever be surfaced on the storefront). `Out of Stock` is not a separately settable status — it is derived from the same stock/inventory data described below (e.g. available quantity is zero) and displayed accordingly; it is not stored as its own independent state.

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

**Stock restoration rule:** Any transition into `CANCELLED` or `RETURNED`, from any prior state in which stock was already decremented (i.e. any state at or after `CONFIRMED`), must automatically restore that stock. This is a single rule applied uniformly in the state-transition handler, not a per-transition special case.

**Stock decrement concurrency:** Because multiple orders can be pending confirmation for the same low-stock variant at once, the decrement at `CONFIRMED` must be an atomic check-and-decrement (e.g. a conditional update that only succeeds if sufficient stock remains), not a read-then-write. If insufficient stock remains at confirmation time, the confirmation must fail and the Admin/Manager must be notified instead of confirming an oversold order.

---

### 5.2 Order Management

The Order Management module will allow authorized Admin/Manager users to manage orders throughout their lifecycle.

Authorized Admin/Manager users with the required permissions can:

- View newly placed orders
- Receive dashboard notifications for new orders
- View individual order details
- View customer information, including whether the order is from a **registered customer** or a **guest** (Section 2.9)
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
- Manage orders with payment status **Pending Verification** (bKash)
- Manage orders with payment status **Pending Verification** (COD)
- Confirm orders
- Cancel orders
- Update order information according to assigned permissions
- Create courier shipments
- Select the courier service
- View shipment information
- View Parcel ID / Tracking ID
- Track shipment progress
- View complete order history
- View applied coupon (if any), discount amount, and resulting order total (Section 8.23, [10-coupon-discount.md](10-coupon-discount.md))

The Order Management module must clearly distinguish between **bKash orders** and **COD orders** because their verification processes are different.

The Order Management module must also clearly indicate, on both the order list and the order detail view, whether an order was placed by a **registered customer** or a **guest** (Section 2.9) — for example a "Guest" badge/label next to the customer name. This is a display distinction only: guest and registered orders live in the same table, use the same statuses, and are otherwise managed identically (confirm, cancel, verify payment, create shipment, etc.).

Payment status, order status, and shipment status will be displayed separately.

---

### 5.3 bKash Order Management

For orders placed using **bKash Send Money**, the Admin or Manager must verify the submitted payment before confirming the order.

The Admin / Manager Order Panel should display information such as:

```text
Order #ORD-1025

Customer: [Guest]
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

As stated in section 3.1, the Transaction ID is unique per order at submission time, so the Admin/Manager verification step is a human check of validity (amount, sender, screenshot), not a duplicate check — duplicate Transaction IDs are already rejected by the backend before reaching this panel.

A bKash order must not be confirmed before successful payment verification.

If the payment cannot be verified, the Admin or Manager can reject the payment according to the payment rejection and resubmission rules defined in the system.

---

### 5.4 COD Order Management

For **Cash on Delivery (COD)** orders, payment verification is not required before shipment.

The Admin or Manager must manually contact the customer and confirm the order.

The Order Panel may display:

```text
Order #ORD-1026

Customer: [Registered]
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

Order amount and COD amount reflect the coupon-discounted final total where a coupon was applied (Section 8.16b, [10-coupon-discount.md](10-coupon-discount.md)).

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

Authorized Admin/Manager users with the required permissions can manage customer information required for business operations.

The customer records managed here include both **registered customers** (have login credentials) and **guest customer references** (Section 2.9.4 — no login credentials, created to hold a guest order's name/phone/address). Both are stored as the same kind of customer record, distinguished by an account-type field, so Admin/Manager customer views, order history, and risk checks (Section 7) work the same way regardless of which type a given customer record is.

Functions may include:

- View customers, with a clear indicator of registered vs. guest account type
- View customer profile information
- View customer contact information
- View customer delivery addresses
- View customer order history (including guest orders placed under that customer record's phone number)
- View payment-related information where permitted
- View shipment information
- View customer account status
- Manage customer accounts according to assigned permissions

Sensitive customer information must only be accessible to Admin/Manager users who have the appropriate permission.

---

### 5.8 Content Management

The back-office will provide CMS functionality for managing storefront content.

Authorized Admin/Manager users with the required permissions can manage:

- Homepage banners
- Promotional sections
- Featured products
- Product categories displayed on the storefront
- Promotional campaigns
- Homepage sections
- Promotional images
- Other configurable storefront content

CMS permissions will be controlled through RBAC.

Admin/Manager users without the required permission must not be able to modify restricted website content.

---

### 5.8a Marketing / Discounts — Coupon Management

Authorized Admin/Manager users with the required permissions can manage coupon codes (create, view, edit, activate/deactivate, delete/archive) under a **Marketing / Discounts → Coupons** section of the back-office. The complete coupon data model, validation rules, discount calculation, usage limits, and RBAC permission rows are defined in Section 8 ([10-coupon-discount.md](10-coupon-discount.md)) — this section exists only to place the module in the back-office's module list; it does not duplicate those rules here.

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
- Returned orders (per the `RETURNED` order status defined in Section 5.21.7 — an undelivered parcel returned to the store, not a post-delivery customer return, which is out of scope for v1)

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

- Total customers (registered + guest customer references, per Section 2.9.4)
- Registered vs. guest order share
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

#### Coupons / Discounts

- Total discount amount given
- Orders using a coupon vs. without
- Usage per coupon (against its usage limit)
- Most-used coupons

See Section 8.29–8.30 ([10-coupon-discount.md](10-coupon-discount.md)) for the coupon-specific Admin list/detail views this reporting builds on.

Analytics should respect the permissions assigned to each role (Admin or Manager).

---

