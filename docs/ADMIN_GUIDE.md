# Frabrilike Admin Guide

**How to run your business on frabrilike.com: a guide for the Admin (owner)**

This guide explains, step by step, how to use the Frabrilike back-office to sell products, handle orders, check payments, send parcels by courier, and manage your staff (Managers).

> There is a separate **Manager Guide** (`MANAGER_GUIDE.md`) for your staff.
> A Bangla version of this guide is in `ADMIN_GUIDE.bn.md`.

---

## Contents

1. [The big picture: how the business runs](#1-the-big-picture-how-the-business-runs)
2. [Logging in and your account](#2-logging-in-and-your-account)
3. [The Dashboard](#3-the-dashboard)
4. [Setting up your shop (one-time setup)](#4-setting-up-your-shop-one-time-setup)
5. [Adding and managing products](#5-adding-and-managing-products)
6. [How a customer places an order](#6-how-a-customer-places-an-order)
7. [Handling orders: the three statuses](#7-handling-orders-the-three-statuses)
8. [bKash orders: verifying payment](#8-bkash-orders-verifying-payment)
9. [Cash on Delivery (COD) orders](#9-cash-on-delivery-cod-orders)
10. [Customer Risk Check (fraud check)](#10-customer-risk-check-fraud-check)
11. [Sending the parcel by courier (Pathao / Steadfast)](#11-sending-the-parcel-by-courier-pathao--steadfast)
12. [After the parcel is sent: tracking, delivery, returns](#12-after-the-parcel-is-sent-tracking-delivery-returns)
13. [Cancelling an order and editing order details](#13-cancelling-an-order-and-editing-order-details)
14. [Customers](#14-customers)
15. [Managers: creating staff accounts and permissions](#15-managers-creating-staff-accounts-and-permissions)
16. [Coupons and discounts](#16-coupons-and-discounts)
17. [Homepage and campaigns](#17-homepage-and-campaigns)
18. [Reports](#18-reports)
19. [Audit Log](#19-audit-log)
20. [Daily routine checklist](#20-daily-routine-checklist)
21. [What to do if… (common problems)](#21-what-to-do-if-common-problems)
22. [Things the developer must set up](#22-things-the-developer-must-set-up)

---

## 1. The big picture: how the business runs

Every sale follows the same path:

```text
Customer orders on frabrilike.com
        ↓
You check the order
   ├── bKash order → check the payment → Verify payment → Confirm order
   └── COD order   → phone the customer → Confirm COD order
        ↓
(Optional) Run a Customer Risk Check
        ↓
Pack the parcel → Create shipment (Pathao or Steadfast)
        ↓
Courier picks up → Mark as shipped
        ↓
Courier delivers → the status updates automatically
        ↓
COD money is collected by the courier and paid to you
```

**Two people can work in the back-office:**

| Role | Who | What they can do |
| --- | --- | --- |
| **Admin** | You, the owner. There is only one Admin account. | Everything, including creating Managers and giving them permissions. |
| **Manager** | Your staff, created by you. | Daily work (orders, payments, parcels, products). They can do extra things only if you allow them. |

---

## 2. Logging in and your account

1. Go to **https://frabrilike.com/admin/login**.
2. Enter your **User ID** and **Password**, then click the login button.
3. **First login:** the system will make you **change your password** before you can do anything else. Choose a strong password and keep it private.

**Important:**
- If you type the wrong password too many times, login is **locked for a short time**. Wait for the countdown to finish, then try again.
- To log out, click **Logout** at the top right. Always log out on shared computers.
- Your Admin account is protected and can't be deleted from the back-office.
- If you forget the Admin password, contact your developer. There is no "forgot password" button for the Admin.

**The menu bar** at the top shows: Orders, Customers, Managers, Products, Categories, Attributes, Reports, Audit Log, Coupons, Homepage, Campaigns, Courier Settings, Shipping.

---

## 3. The Dashboard

Open **https://frabrilike.com/admin** to see the Dashboard. Each card shows a count. **Click a card** to open the matching list of orders.

| Card | Meaning | What you should do |
| --- | --- | --- |
| **New orders** | Orders that came in since your last visit | Open and start working on them |
| **Awaiting bKash verification** | Customer says they paid by bKash | Check the payment in your bKash account (Section 8) |
| **COD awaiting confirmation** | Cash on Delivery orders not yet confirmed | Phone the customer (Section 9) |
| **Payment rejected** | You rejected a bKash payment; waiting for the customer to resubmit | Follow up by phone |
| **Stale unconfirmed** | Orders left unconfirmed for too long | Decide: confirm or cancel |
| **Failed shipments** ⚠️ | Parcel creation with the courier failed | Retry or change courier (Section 11) |
| **COD money not yet collected** ⚠️ | Delivered COD orders whose money is still not marked collected | Check with the courier (Section 12) |
| **Courier needs attention** ⚠️ | Tracking updates stopped for a parcel | Check in the courier's merchant panel |
| **Parcels not moving (X+ days)** ⚠️ | No movement for several days | Contact the courier |
| **Returned (last 30 days)** | Parcels that came back | Check the returned stock |
| **Total orders** | All orders | — |

Cards marked ⚠️ get a **yellow border** when the count is above zero. Treat these as problems to fix.

---

## 4. Setting up your shop (one-time setup)

Do these once, before you start selling, in this order:

1. **Categories:** create your product categories (Section 5.1).
2. **Attributes:** create sizes, colours, age groups (Section 5.2).
3. **Products:** add products with images, prices and stock (Section 5.3).
4. **Shipping:** set delivery charges by area (Section 4.1 below).
5. **Courier Settings:** turn on Pathao and/or Steadfast (Section 4.2 below).
6. **Homepage:** build the homepage banners and sections (Section 17).
7. **Managers:** create accounts for your staff (Section 15).

### 4.1 Shipping (delivery charges)

Menu: **Shipping**

The delivery charge is calculated automatically at checkout based on the customer's **district**.

- **Shipping zones:** a zone is a group of districts with the same charge, for example "Inside Dhaka" and "Outside Dhaka".
  - Give the zone a **Name** and **Code**, add its **Districts**, and set an **Initial rate**.
  - One zone is the **default zone**. It is used when a district doesn't belong to any zone.
  - **Metro only**: tick this for a city-only zone.
- **Rates:** for each zone, choose a **Strategy** and **Charge (৳)**. You can also set **Free over (threshold, ৳)**, so orders above that amount get free delivery.
- **Unmatched districts:** this panel lists districts not in any zone. Use **Add to zone** to place them.

When you change a rate, the system asks you to confirm. New rates apply to new orders only. Old orders keep the charge they were placed with.

### 4.2 Courier Settings

Menu: **Courier Settings**

For each courier (Pathao, Steadfast) you will see:

- **Credentials: Configured / Not configured.** The API keys are stored securely on the server by your developer and can't be typed in here. If it says *Not configured*, ask your developer.
- **Enabled:** turn on the couriers you want to use. Only enabled couriers appear when you create a shipment.
- **Display order:** which courier appears first in the list.
- **Tracking URL template:** the link used for "Track on Pathao/Steadfast".

---

## 5. Adding and managing products

### 5.1 Categories

Menu: **Categories**

- Click **Add Category**, enter a **Name**, and optionally choose a **Parent Category** to make it a sub-category (for example *Men → T-Shirts*). Leave it blank for a top-level category.
- Use **Move up / Move down** to change the order categories appear in.
- **Edit Category** renames it. Inactive categories are hidden from customers.

### 5.2 Attributes (Size, Colour, Age group)

Menu: **Attributes**

1. Click **New attribute**, give it a **Name** (for example "Size") and a **Type**: *Size*, *Colour*, *Age group* or *Other*.
2. Add its **values**, for example S, M, L, XL, or Black, White, Navy.

You only do this once. The values are then used for every product.

### 5.3 Adding a product

Menu: **Products** → add a new product

1. Fill in:
   - **Product Name**, **Description**, **Category**
   - **Base Price (৳)**: the selling price
   - **Compare-at Price (optional)**: the old or "crossed-out" price, to show a discount
   - **SKU (optional)**: your own product code
   - **Weight (grams, optional)**: helps the courier
   - **Stock Quantity**
   - **Active**: tick it to show the product on the website. Untick it to hide the product.
   - **Featured**: tick it to highlight the product (for example on the homepage)
2. **Save** the product.
3. **Images:** after saving, the page lets you upload images.
   - Tap **"Tap to upload or take photo"**. On a phone you can use the camera.
   - Write **Alt text** (a short description such as "Black cotton T-shirt, front"). It helps Google and blind users.
   - Choose one image as **Primary**. This is the main photo.
   - There is a maximum number of images. Delete one to add another.
4. **Variants (size/colour combinations):** for products that come in sizes or colours:
   - Click **New variant**, choose the **Attribute values** (for example *Black + M*).
   - Set **Stock Quantity** for that variant.
   - Optional: **Variant Price Override** (if this size costs more), **Variant SKU**, and **Low-stock Threshold** (warns you when stock is low).

### 5.4 Updating stock

On the product page, in a variant, use **Set stock**. Enter the **New Stock Quantity** and a **Reason for change** (for example "New shipment arrived"). Every change is recorded.

**How stock works automatically:**
- Stock goes **down when an order is confirmed**, not when the customer places it.
- Stock comes **back automatically** if a confirmed order is **cancelled** or **returned**.
- If there isn't enough stock when you click Confirm, the system **refuses to confirm** and tells you. You can't oversell.
- When stock reaches 0, the website shows **Out of Stock** automatically.

### 5.5 Hiding or deleting a product

- To **hide** a product, open it, untick **Active** and save. Customers will no longer see it, but its old orders and history stay safe.
- The product pages currently have **no Delete button**. Hiding (untick Active) is the way to remove a product from the shop. You can still delete individual **images** and **variants**.

---

## 6. How a customer places an order

You don't create orders in the back-office. **Customers order on the website.** Knowing their side helps you answer their questions.

1. The customer browses **frabrilike.com**, chooses a product, size and colour, and clicks **Add to cart**.
2. At **Checkout** they either log in (registered customer) or order as a **Guest** with no account.
3. They enter their **name, phone and delivery address** (Division → District → Upazila/Thana → address).
4. The delivery charge is added automatically based on their district. They can enter a **coupon code**.
5. They choose how to pay:
   - **bKash (Send Money):** they send the money to your bKash number shown on the page, then enter the **Transaction ID** and can upload a **screenshot**.
   - **Cash on Delivery (COD):** they pay the courier when the parcel arrives.
6. They get an **Order Number** (for example ORD-1025).
7. Later they can check their order on the website using **Order Number + Phone** (guests) or from **My Account** (registered), and track the parcel on **Track Order**.

**If a customer wants to order by phone or Facebook:** there is no "create order" button in the back-office. You can place the order for them on the website as a **Guest**, using the customer's own name, phone and address.

---

## 7. Handling orders: the three statuses

Menu: **Orders**

Every order shows **three separate statuses**. Always read all three.

**1. Order status: where the order is**

| Status | Meaning |
| --- | --- |
| Pending confirmation | New bKash order, waiting for payment check |
| COD verification pending | New COD order, waiting for you to phone the customer |
| Confirmed | Approved. Stock has been reserved |
| Processing | Being packed |
| Delivered | Customer received it |
| Cancelled | Cancelled |
| Returned | Parcel came back undelivered |

**2. Payment status: the money**

| Status | Meaning |
| --- | --- |
| Pending verification | Customer says they paid by bKash; you must check |
| Paid (verified) | You checked and the bKash payment is correct |
| Rejected | You rejected the bKash payment (or COD money is not recoverable) |
| Pending collection | COD: the courier will collect the money |
| Paid (collected) | COD: the money has been collected |

**3. Shipment status: the parcel**

| Status | Meaning |
| --- | --- |
| Not created | No parcel yet |
| Creating | Sending the parcel request to the courier |
| Created | The courier has accepted the parcel |
| Creation failed | The courier request failed (Section 11) |
| Shipped | Handed over to the courier |
| In transit / Out for delivery | On the way |
| Delivered | Delivered |
| Delivery failed | The courier couldn't deliver |
| Returned | Came back |

### The order list

- Use the **filter tabs** at the top: All, Pending verification, COD pending, Confirmed, Processing, Delivered, Cancelled, Returned, Payment rejected, Stale unconfirmed, Failed shipment, COD discrepancy, Courier needs attention, Parcel not moving, Returned (30 days).
- Orders from customers without an account show a **Guest** badge. Guest orders are handled exactly the same way.
- Click an order to open its **detail page**.

### The order detail page

It shows the customer, delivery address, products and quantities, coupon and discount, total, the **Payment** section, the **Customer Risk** section and the **Shipment** section.

At the bottom is an **action bar**. It only shows the buttons that make sense **right now**. For example, you won't see "Create shipment" before the order is confirmed. If a button is missing, the order isn't at that step yet.

---

## 8. bKash orders: verifying payment

**Rule: a bKash order can't be confirmed until the payment is verified.**

1. Open the order (Dashboard → **Awaiting bKash verification**).
2. In the **Payment** section, look at:
   - **Amount due**
   - **bKash transaction ID**
   - **Payment screenshot** (click to view, if the customer uploaded one)
3. Open **your own bKash merchant account or app** and check that:
   - a payment with **this Transaction ID** exists,
   - the **amount is correct**,
   - it was received recently.
4. **If everything matches:** click **Verify payment**. The payment becomes **Paid (verified)**.
5. Then click **Confirm order**. The order becomes **Confirmed** and stock is reserved.
6. **If it doesn't match:** click **Reject payment**, choose a reason:
   - Invalid transaction ID
   - Transaction does not match
   - Incorrect amount
   - Payment could not be verified
   - Unclear screenshot
   - Payment not completed
   - Other

   Add a note, then confirm.
   - The order **stays open**. The customer can **resubmit** a correct Transaction ID from their order page.
   - **Phone the customer** and explain what went wrong.
7. When the customer resubmits, the order comes back to **Pending verification**. Check it again from step 2.

**Good to know:**
- The system already blocks a Transaction ID that was used on another order, so you won't see duplicates.
- If the customer never fixes the payment, the order shows up under **Stale unconfirmed**. You can cancel it. Nothing is cancelled automatically.

---

## 9. Cash on Delivery (COD) orders

COD orders need **no payment check**, but you must **phone the customer** to make sure the order is real.

1. Open the order (Dashboard → **COD awaiting confirmation**).
2. Check the products, total and address.
3. Optionally run a **Customer Risk Check** (Section 10). It's strongly recommended for COD.
4. **Phone the customer** on the number shown. Confirm the product, size, address and total amount.
5. **If they confirm:** click **Confirm COD order**. The order becomes **Confirmed**.
6. **If they say no, or can't be reached after several tries:** click **Cancel order** and write the reason.

The payment stays **Pending collection** until the courier collects the cash. Then it becomes **Paid (collected)**.

---

## 10. Customer Risk Check (fraud check)

The risk check shows the customer's **past courier delivery history**, based on their phone number. It helps you avoid fake COD orders.

1. On the order page, find the **Customer Risk** section.
2. Click **Check Customer Risk**.
3. You will see: total orders, delivered, returned, success rate, and a **risk level**:

| Level | Meaning | Suggested action |
| --- | --- | --- |
| **LOW RISK** | Usually accepts deliveries | Normal confirmation |
| **MEDIUM RISK** | Some returns | Phone carefully, consider asking for an advance |
| **HIGH RISK** | Many returns or cancels | Be very careful, consider asking for bKash advance payment |
| **UNKNOWN** | No courier history found | A new customer. **This is not a sign of fraud** |
| **CHECK FAILED** | The check service is unavailable | Click **Try Again** later |

- The result is **saved**. The page shows the stored result and **Last Checked** date until you run a new check.
- The risk check **never blocks or cancels an order by itself**. You make the decision.
- **Each check uses one lookup from your BD Courier plan.** The saved result costs nothing to view, so only run a new check when you need fresh data. You can run at most **3 checks per customer every 15 minutes**. After that you'll see "Too many checks for this customer. Try again in … seconds."
- **The success rate here may differ from the BD Courier website.** This page shows delivered ÷ total parcels. BD Courier's website averages each courier's success rate. The **risk level** always comes from BD Courier.
- **"Risk check is not configured."** means the BD Courier API key is missing on the server. Ask your developer to add it. If you ever **regenerate the API key** on app.courier.com.bd, the developer must put the new key on the server too, or every check will fail.

> **Update (6 November 2026):** BD Courier is now connected and live-tested. BD Courier changed the names of its risk levels, so before this fix, customers BD Courier marks as **"High risk"** showed as **UNKNOWN** here. This is fixed. If an earlier check showed **UNKNOWN** for a customer with many past parcels, run the check again.

---

## 11. Sending the parcel by courier (Pathao / Steadfast)

You can create a shipment **only when**:
- the order is **Confirmed** or **Processing**, and
- for bKash orders, the payment is **Paid (verified)**.

### Step by step

1. *(Optional)* Click **Start processing** while you pack the parcel. The order becomes **Processing**.
2. Go to the **Shipment** section on the order page.
3. Check the **Delivery address** and, for COD, the **COD amount to collect**. The courier will collect exactly this amount.
4. Choose the **Courier**: Pathao or Steadfast.
5. Click **Create shipment**.
6. The system sends all the details (name, phone, address, amount, weight, instructions) to the courier automatically. **You don't need to type anything in the courier's panel.**
7. The status becomes **Created**. You will see the courier's **Consignment/Tracking ID** and a **Track on Pathao / Steadfast** link.
8. Write the consignment ID on the parcel if your courier asks you to, then hand it to the courier rider.
9. When the courier has **picked up** the parcel, click **Mark as shipped**. The shipment becomes **Shipped**.

### If shipment creation fails

The page shows a red box, **"Shipment creation failed"**, with the courier's error message. **Your order and payment are not affected.** The order stays Confirmed.

You have three options:

- **Retry:** try the same courier again (good if it was a temporary network problem).
- **Change courier:** choose the other courier and click **Create shipment with this courier**.
- **Link parcel:** if you already created the parcel manually in the courier's panel, paste its **Consignment ID** and click **Link parcel**. The ID is checked with the courier before it is saved.

**⚠️ Special warning: "the courier may already have created this parcel"**

Sometimes the courier doesn't give a clear answer, so the parcel **may exist** even though it looks failed. **Retrying now could create a second parcel**, with two pickups and two charges. The page will tell you to:

1. Open the courier's **merchant panel** (Pathao or Steadfast website) and search for the **order number**.
2. **If the parcel is there:** paste its consignment ID and click **Link parcel**.
3. **If it's not there:** tick **"I checked the merchant panel and there is no parcel for this order"**, then click **Retry** or **Change courier**.

### If it's stuck on "Creating"

Click **Refresh**. If it doesn't finish within about **10 minutes**, the system unlocks it automatically and asks you to check the courier panel, as above.

**Courier call history:** click **Courier call history** in the Shipment section to see each request sent to the courier and its result. This is useful when talking to courier support.

---

## 12. After the parcel is sent: tracking, delivery, returns

- The system **checks the courier automatically about every 15 minutes** and updates the shipment status (In transit, Out for delivery, Delivered, Returned…). You don't need to update it by hand.
- When the courier marks it **Delivered**, the order becomes **Delivered**. For COD, the payment becomes **Paid (collected)**.
- If the parcel is **returned**, the order becomes **Returned** and **stock is added back automatically**.
- Customers can track their parcel themselves on the website's **Track Order** page.

### Warnings to watch

- **"Needs attention: tracking updates have stopped for this parcel":** the system couldn't get updates from the courier. Check the parcel in the courier's merchant panel. The status shown is **never guessed**. It stays as it was until the problem is fixed.
- **Parcels not moving (X+ days):** contact the courier about these parcels.
- **COD money not yet collected (COD discrepancy):** the order is Delivered but the COD money isn't marked collected. Check your courier payment statement:
  - If you received the money: click **Mark COD collected**.
  - If the money is lost and can't be recovered: click **Mark not recoverable** and write the reason. The order stays Delivered and the payment is marked Rejected.

---

## 13. Cancelling an order and editing order details

### Cancel an order

Click **Cancel order** and write a reason.
- If the order was already confirmed, **stock is restored automatically**.
- **Coupon usage is not restored.** The coupon use still counts.
- If a parcel was already created, cancel it with the courier too.

### Edit order information

On the order page, **Edit order information** lets you change:
- **Contact name** and **Contact phone**
- **Detailed address** and **Postal code**
- **Delivery instructions for the courier** (up to 250 characters)
- **Internal note (staff only)**: customers never see this

Do this **before** creating the shipment, because the courier receives the details at creation time.

You **can't** change prices, products or totals of an existing order. This protects you from mistakes and fraud. If a customer wants different items, cancel the order and ask them to order again.

---

## 14. Customers

Menu: **Customers**

- See every customer, both **Registered** (has an account) and **Guest**.
- Open a customer to see their **phone, email, address, "customer since" date**, their **order statistics** (number of orders, total paid) and their **order list**.
- You can **edit** the customer's full name, email, detailed address and postal code.
- Guest orders with the same phone number are shown together.

---

## 15. Managers: creating staff accounts and permissions

Menu: **Managers** (only you, the Admin, can see this)

### 15.1 Create a Manager

1. Go to **Managers** → **Add Manager**.
2. Enter a **User ID** (3–64 characters: letters, numbers, dot, underscore or dash, for example `rahim.sales`).
3. Enter a **temporary password** (at least **12 characters**).
4. Tick the **extra permissions** you want this Manager to have (see 15.3).
5. Click **Create Manager**.
6. Give the User ID and temporary password to your staff member **privately** (in person or by phone, not in a group chat).
7. On their first login, the Manager **must change the password**.

### 15.2 What every Manager can do automatically

You don't need to tick anything for these. Every Manager has them:

- View the dashboard
- Add and edit products, categories, images, sizes/colours, variants, prices, stock and visibility
- View orders, **verify or reject bKash payments**, review resubmissions
- **Confirm orders and COD orders**, start processing
- View customers, run **Customer Risk Checks**
- **Create shipments**, choose the courier, retry, change courier, track parcels
- View coupons and coupon usage

### 15.3 Extra permissions you can give (tick boxes)

**Operational permissions**

| Permission | What it allows |
| --- | --- |
| Analytics View | See the **Reports** pages (sales, revenue, etc.) |
| Audit Log View | See the **Audit Log** |
| Product Delete | Permanently delete products (reserved for future use: there is no product Delete button yet) |
| Order Update | Edit order information; mark COD collected / not recoverable |
| Order Cancellation | **Cancel orders** |
| Customer Update | Edit customer details |
| Courier Configuration | Change **Courier Settings** |
| CMS Management | Edit the **Homepage** and **Campaigns** |
| Coupon Create / Update / Activate-Deactivate / Delete-Archive | Manage coupons |

**Advice:** start with fewer permissions and add more as you trust the staff member. Sensitive ones are **Order Cancellation**, **Coupon** permissions (they affect your money) and **Courier Configuration**.

**Things a Manager can never do**, even if you wanted them to: create, edit or delete other Managers, change permissions, change Shipping settings, or touch the Admin account.

### 15.4 Edit, deactivate or delete a Manager

Open the Manager from the list:

- **User ID:** change it if needed.
- **New Password (leave blank to keep current):** reset a forgotten password. Give the new one to the Manager privately.
- **Permissions:** tick or untick, then save. You will see "Permissions updated."
- **Deactivate:** blocks login immediately but keeps the account and history. Use this when someone is on leave or leaves the job. **Reactivate** turns it back on.
- **Delete Manager:** removes the account permanently. Deactivating is usually better, because the history stays clear.

Every Manager action is recorded in the **Audit Log**, under that Manager's name.

---

## 16. Coupons and discounts

Menu: **Coupons**

### Create a coupon

Click **Add Coupon** and fill in:

- **Code:** what customers type, for example `EID20`
- **Name** and **Description (optional)**
- **Discount Type:**
  - **Percentage**, for example 20% off
  - **Fixed amount**, for example ৳200 off
- **Maximum discount amount (৳, optional):** a cap for percentage coupons, for example "20% off, maximum ৳500"
- **Minimum order amount (৳, optional):** for example "only for orders above ৳1500"
- **Starts at** / **Expires at:** the active dates
- **Total usage limit (optional):** for example only the first 100 uses
- **Per-customer usage limit (optional):** for example one use per customer
- Who can use it: **All customers** or **Registered customers only**

### Manage coupons

- Open a coupon to edit it, **activate/deactivate** it, or **delete/archive** it.
- **Usage list:** shows the orders that used this coupon, newest first.
- The discount is always calculated by the server. Customers can't change prices.

---

## 17. Homepage and campaigns

### 17.1 Homepage builder

Menu: **Homepage**

The homepage is made of **sections**. Click **Add Section** and choose a type:

| Section type | Use it for |
| --- | --- |
| **Hero** | Big top banner with a title, subtitle, desktop and mobile images, and buttons (CTA) |
| **Category Grid** | Category tiles (all active top-level categories, or chosen ones) |
| **Product Carousel** | A sliding row of products: **Automatic** (Latest, Featured, On sale, by Category) or **Manual selection** |
| **Campaign Banner** | A banner linking to a campaign |
| **Custom Content** | Free text or image block |

For each section:
- **Status:** *Draft* (not visible), *Active* (visible) or *Disabled*.
- **Starts at / Ends at:** schedule a section, for example for an Eid offer, so it appears and disappears by itself.
- Always upload **both desktop and mobile images**. Most of your customers use phones.
- Use **Preview** to see the homepage before publishing.

### 17.2 Campaigns

Menu: **Campaigns**

A campaign is a special sale page (for example "Eid Collection 2026").

1. Click to add a new campaign. Enter **Name**, **Slug** (the web address part, for example `eid-2026`), **Description**, **Starts at / Ends at**, **Status** (Draft / Active / Disabled).
2. Optional hero content: **Hero title, subtitle, desktop and mobile images, CTA label and URL**.
3. **Visual theme** and **Banner treatment** (plain, bordered, accent, etc.).
4. **Save first**, then attach **products and categories** to the campaign.
5. Link the campaign on the homepage using a **Campaign Banner** section.

Times use your browser's time zone (Bangladesh time).

---

## 18. Reports

Menu: **Reports**

| Report | Shows |
| --- | --- |
| **Sales** | Total sales, revenue, average order value, trends, sales by product and category |
| **Orders** | Orders by status (pending, confirmed, delivered, cancelled, returned…) |
| **Payments** | bKash vs COD, verified, rejected, pending, COD collected |
| **Products** | Best sellers, stock, low-stock and out-of-stock products |
| **Customers** | New vs returning customers, registered vs guest share |
| **Shipments** | Shipments by courier, delivered, failed, returned |
| **Coupons** | Total discount given, usage per coupon, most-used coupons |

- Days are counted in **Bangladesh (Dhaka) time**.
- **Revenue counts delivered orders**, so it shows money actually earned.
- Report numbers refresh about **every hour**, so a brand-new order may take a little time to appear.
- You can **export reports to CSV** (opens in Excel). The file is prepared in the background and is usually ready within a few minutes.

---

## 19. Audit Log

Menu: **Audit Log**

A permanent record of **who did what and when**: payment verified, order cancelled, permission changed, product price changed, and so on. You can filter it by type. Entries marked **System** were done automatically, for example courier status updates.

Use it when something looks wrong ("who cancelled this order?").

---

## 20. Daily routine checklist

**Morning**
- [ ] Open the **Dashboard**.
- [ ] **Awaiting bKash verification:** verify payments and confirm orders.
- [ ] **COD awaiting confirmation:** run risk checks, phone customers, confirm or cancel.
- [ ] Pack confirmed orders → **Create shipment** → hand over to the courier → **Mark as shipped**.

**Afternoon / evening**
- [ ] Check the ⚠️ cards: **Failed shipments**, **Courier needs attention**, **Parcels not moving**.
- [ ] **Payment rejected** and **Stale unconfirmed:** follow up by phone, or cancel.

**Weekly**
- [ ] Check **COD money not yet collected** against the courier's payment statement.
- [ ] Look at **Reports** (sales, best sellers, low stock).
- [ ] Update stock for new arrivals. Untick **Active** on items you no longer sell.
- [ ] Look over the **Audit Log** for anything unusual.

---

## 21. What to do if… (common problems)

| Problem | What to do |
| --- | --- |
| A button I expect is missing | The order isn't at that step yet (for example, no shipment before Confirmed), or the bKash payment isn't verified yet. |
| "Confirm" fails with a stock error | Not enough stock. Add stock or phone the customer about a different size. |
| Customer sent the wrong bKash amount | **Reject payment** → "Incorrect amount". Phone them. They can send the difference and resubmit, or you can cancel. |
| Customer wants to change their address | Use **Edit order information** *before* creating the shipment. |
| Customer wants a different size or product | Cancel the order and ask them to place a new one. |
| Shipment creation failed | See Section 11. Check the courier panel first if warned, then Retry, Change courier, or Link parcel. |
| Customer says "I didn't get my parcel" | Open the order → Shipment → **Track on Pathao/Steadfast**, or check the courier panel. |
| Parcel returned | It updates automatically to Returned and stock comes back. Check the item's condition. |
| Courier says "Not configured" | Your developer must add the courier API keys on the server. |
| Risk check says "Risk check is not configured." | The BD Courier API key is missing or was regenerated. Your developer must update it on the server. |
| UNKNOWN for a customer who has ordered many times | Run the check again. Results from before 6 November 2026 could show UNKNOWN instead of HIGH RISK (Section 10). |
| A Manager forgot their password | Managers → open the Manager → **New Password** → save, then tell them privately. |
| A staff member left the job | **Deactivate** their Manager account immediately. |
| Login locked | Wait for the countdown, then try again with the correct password. |

---

## 22. Things the developer must set up

These are **not** changed from the back-office. Ask your developer:

- **Courier API keys** for Pathao and Steadfast
- **Your bKash number** shown to customers at checkout
- **WhatsApp number** for the chat button on the website
- **Email (SMTP) settings** for customer password-reset emails
- **Meta (Facebook) Pixel** settings for ads tracking
- **Admin password reset** if you forget it
- **Automatic jobs** (courier status checks, report refresh, CSV exports) must keep running on the server

---

*Frabrilike · https://frabrilike.com*
