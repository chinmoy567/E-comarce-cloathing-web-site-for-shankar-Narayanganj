# Frabrilike Manager Guide

**How to do your daily work on frabrilike.com: a guide for Managers (staff)**

This guide explains how to handle orders, check bKash payments, confirm COD orders, send parcels by courier, and keep products up to date.

> A Bangla version of this guide is in `MANAGER_GUIDE.bn.md`.

---

## Contents

1. [Your role](#1-your-role)
2. [Logging in](#2-logging-in)
3. [What you can and can't do](#3-what-you-can-and-cant-do)
4. [The Dashboard](#4-the-dashboard)
5. [How a customer places an order](#5-how-a-customer-places-an-order)
6. [Understanding an order: the three statuses](#6-understanding-an-order-the-three-statuses)
7. [bKash orders: verifying payment](#7-bkash-orders-verifying-payment)
8. [COD orders: phoning the customer](#8-cod-orders-phoning-the-customer)
9. [Customer Risk Check](#9-customer-risk-check)
10. [Sending the parcel by courier](#10-sending-the-parcel-by-courier)
11. [After the parcel is sent](#11-after-the-parcel-is-sent)
12. [Products, stock and categories](#12-products-stock-and-categories)
13. [Customers](#13-customers)
14. [Coupons](#14-coupons)
15. [Extra features (only if the Admin allows)](#15-extra-features-only-if-the-admin-allows)
16. [Daily routine checklist](#16-daily-routine-checklist)
17. [What to do if…](#17-what-to-do-if)

---

## 1. Your role

You are a **Manager**. The **Admin** (the owner) created your account and decides what you can do. Your job is the day-to-day work:

```text
New order arrives
   ├── bKash → check payment → Verify payment → Confirm order
   └── COD   → phone customer → Confirm COD order
        ↓
Pack → Create shipment (Pathao / Steadfast) → Mark as shipped
        ↓
Courier delivers → status updates automatically
```

**Everything you do is recorded under your name** in the Audit Log. Work carefully and never share your password.

---

## 2. Logging in

1. Go to **https://frabrilike.com/admin/login**.
2. Enter the **User ID** and **temporary password** the Admin gave you.
3. **First login:** you **must change your password**. Choose a strong one (at least 12 characters) that only you know.
4. Click **Logout** (top right) when you finish, especially on a shared computer.

- Too many wrong passwords **lock the login for a short time**. Wait for the countdown.
- **Forgot your password?** Ask the Admin to set a new one for you.
- If you can't log in at all, your account may have been **deactivated**. Contact the Admin.

---

## 3. What you can and can't do

The **menu bar only shows the pages you're allowed to use.** If you don't see a page, you don't have permission for it.

### ✅ You can always do

- View the **Dashboard**
- **Orders:** view orders, **verify or reject bKash payments**, review resubmitted payments, **confirm orders**, **confirm COD orders**, start processing
- **Customer Risk Check**
- **Shipments:** create a shipment, choose the courier, retry, change courier, link a parcel, mark as shipped, track
- **Products:** add and edit products, images, sizes/colours, variants, prices, stock, Active/Featured
- **Categories** and **Attributes**
- **Customers:** view customer details and order history
- **Coupons:** view coupons and their usage

### 🔒 Only if the Admin gives you permission

| Feature | Permission name |
| --- | --- |
| Cancel orders | Order Cancellation |
| Edit order information, mark COD collected | Order Update |
| Edit customer details | Customer Update |
| See Reports | Analytics View |
| See the Audit Log | Audit Log View |
| Edit the Homepage and Campaigns | CMS Management |
| Change Courier Settings | Courier Configuration |
| Create / edit / activate / delete coupons | Coupon Create / Update / Activate-Deactivate / Delete-Archive |

### ❌ Managers can never do

- Create, edit or delete other Manager accounts
- Change anyone's permissions, including your own
- Change **Shipping** (delivery charge) settings
- Touch the Admin account

If you need something from the 🔒 or ❌ lists done, **ask the Admin.**

---

## 4. The Dashboard

Open **https://frabrilike.com/admin**. **Click any card** to open the matching orders.

| Card | What you should do |
| --- | --- |
| **New orders** | Start working on them |
| **Awaiting bKash verification** | Check the payment (Section 7) |
| **COD awaiting confirmation** | Phone the customer (Section 8) |
| **Payment rejected** | Phone the customer to fix the payment |
| **Stale unconfirmed** | Tell the Admin, or cancel if you have permission |
| **Failed shipments** ⚠️ | Retry or change courier (Section 10) |
| **COD money not yet collected** ⚠️ | Report to the Admin |
| **Courier needs attention** ⚠️ | Check the courier's merchant panel |
| **Parcels not moving** ⚠️ | Contact the courier |
| **Returned (last 30 days)** | Check returned items |

Cards with ⚠️ get a **yellow border** when there is a problem.

---

## 5. How a customer places an order

Customers order on the website. You don't create orders in the back-office.

1. The customer adds products to the **cart** and goes to **Checkout**, logged in or as a **Guest**.
2. They enter their name, phone and address (Division → District → Upazila/Thana). The delivery charge is added automatically. They can use a **coupon**.
3. They pay by:
   - **bKash Send Money:** they send money to the shop's bKash number, then enter the **Transaction ID** and can upload a **screenshot**.
   - **Cash on Delivery (COD):** they pay the courier on delivery.
4. They get an **Order Number** (for example ORD-1025) and can check or track it on the website.

**Phone or Facebook orders:** place the order for the customer on the website as a **Guest**, using the customer's own name, phone and address.

---

## 6. Understanding an order: the three statuses

Menu: **Orders** → click an order.

Each order has **three separate statuses**:

- **Order status:** Pending confirmation → (or COD verification pending) → Confirmed → Processing → Delivered. It can also be Cancelled or Returned.
- **Payment status:** Pending verification → Paid (verified) or Rejected *(bKash)*; Pending collection → Paid (collected) *(COD)*.
- **Shipment status:** Not created → Creating → Created → Shipped → In transit → Out for delivery → Delivered. It can also be Creation failed, Delivery failed or Returned.

A **Guest** badge means the customer has no account. Handle the order the same way.

The **action bar** at the bottom only shows the buttons allowed right now. If a button is missing, the order isn't at that step yet, or you don't have permission.

---

## 7. bKash orders: verifying payment

**Never confirm a bKash order before the payment is verified.**

1. Open the order. In **Payment**, note the **Amount due**, **bKash transaction ID** and **Payment screenshot**.
2. Check the shop's **bKash account**. Find the payment with this **exact Transaction ID** and the **exact amount**.
   *(If you don't have access to the bKash account, ask the Admin to confirm the payment for you.)*
3. **Correct?** Click **Verify payment**, then click **Confirm order**.
4. **Not correct?** Click **Reject payment**, choose the reason (Invalid transaction ID, Transaction does not match, Incorrect amount, Payment could not be verified, Unclear screenshot, Payment not completed, Other), add a note, and confirm.
   - The order stays open. The customer can **resubmit** from their order page.
   - **Phone the customer** and explain politely.
5. When they resubmit, the order returns to **Pending verification**. Check it again.

---

## 8. COD orders: phoning the customer

1. Open the order. Check the products, total and address.
2. Run a **Customer Risk Check** (Section 9).
3. **Phone the customer.** Confirm the product, size, colour, full address and the **total amount to pay the courier**.
4. **They confirm:** click **Confirm COD order**.
5. **They refuse, or don't answer after several tries:** click **Cancel order** with a reason if you have the cancel permission. If you don't, add a note and tell the Admin.

**If you see "not enough stock" when confirming:** the item ran out. Phone the customer about another size or colour, and tell the Admin.

---

## 9. Customer Risk Check

On the order page → **Customer Risk** → click **Check Customer Risk**.

It shows the customer's past courier deliveries (total, delivered, returned, success rate) and a level:

- **LOW RISK:** safe, confirm normally.
- **MEDIUM RISK:** phone carefully.
- **HIGH RISK:** many returns. **Tell the Admin before confirming.** They may ask for advance payment.
- **UNKNOWN:** no history. This is a **new customer, not a fraud sign**.
- **CHECK FAILED:** the service is down. Click **Try Again** later.

The check **never cancels an order by itself**. The result is saved with the **Last Checked** date.

- **Each check uses one lookup from the shop's BD Courier plan.** Don't re-run it if a recent saved result is already showing. You can run at most 3 checks per customer every 15 minutes.
- The success rate here (delivered ÷ total) may differ from the BD Courier website. The risk level comes from BD Courier.
- **"Risk check is not configured."** means the service isn't set up. Tell the Admin.

> **Update (6 November 2026):** BD Courier is now connected. Before this fix, some **high-risk** customers showed as **UNKNOWN**. If an older result shows **UNKNOWN** for a customer with many past parcels, run the check again.

---

## 10. Sending the parcel by courier

You can create a shipment only after the order is **Confirmed** (and, for bKash, the payment is **Paid (verified)**).

1. *(Optional)* Click **Start processing** while packing.
2. In the **Shipment** section, check the **Delivery address** and the **COD amount to collect**.
3. Choose **Pathao** or **Steadfast**.
4. Click **Create shipment**. All the details go to the courier automatically. **Don't type anything in the courier's website.**
5. The status becomes **Created**, and you see the **Consignment ID** and the **Track** link.
6. Hand the parcel to the rider. After pickup, click **Mark as shipped**.

### If it fails ("Shipment creation failed")

The order and payment are **not** affected. Choose one:
- **Retry:** try again with the same courier.
- **Change courier:** choose the other courier → **Create shipment with this courier**.
- **Link parcel:** if the parcel already exists in the courier's panel, paste its **Consignment ID** → **Link parcel**.

**⚠️ If the page says the courier "may already have created this parcel":**
1. Open the courier's **merchant panel** and search for the order number.
2. **Found it?** Use **Link parcel**.
3. **Not found?** Tick **"I checked … there is no parcel"**, then **Retry**.

**Never retry without checking.** You could create two parcels, which means two pickups and two charges.

**Stuck on "Creating"?** Click **Refresh**. If it isn't done after about 10 minutes, it unlocks by itself and asks you to check the courier panel.

---

## 11. After the parcel is sent

- The system checks the courier **automatically about every 15 minutes**. Delivered, Returned and the other statuses update **by themselves**.
- **Returned** parcels put the stock back automatically. Check the item's condition when it arrives.
- **"Needs attention: tracking updates have stopped":** check the parcel in the courier's merchant panel and tell the Admin.
- **COD money not yet collected:** tell the Admin. Only someone with the *Order Update* permission can mark it collected.

---

## 12. Products, stock and categories

### Add a product (Menu: **Products**)

1. Fill in **Product Name, Description, Category, Base Price (৳)**, and optionally **Compare-at Price** (the old price), **SKU** and **Weight (grams)**.
2. Set **Stock Quantity**. Tick **Active** to show it on the website. Tick **Featured** to highlight it.
3. **Save**, then upload **images**: tap **"Tap to upload or take photo"**, write **Alt text** (for example "Navy polo shirt, front"), and set one image as **Primary**.
4. **Variants:** click **New variant**, choose the size/colour, and set its **Stock Quantity**. Optionally set a price override and a **Low-stock Threshold**.

### Update stock

In a variant, use **Set stock** → **New Stock Quantity** + **Reason for change** (for example "Received 20 pcs from supplier").

- Stock goes **down when an order is confirmed** and comes **back if it is cancelled or returned**. This happens automatically.
- To stop selling a product, **untick Active**. There is no product Delete button.

### Categories and Attributes

- **Categories:** Add Category, optionally choose a **Parent Category** for sub-categories, and use Move up/down to change the order.
- **Attributes:** sizes, colours and age groups and their values (S, M, L… / Black, White…).

---

## 13. Customers

Menu: **Customers**. You can see each customer's phone, email, address, order statistics and order list, for both Registered and Guest customers. Editing details needs the *Customer Update* permission.

**Customer information is private.** Never share phone numbers or addresses outside the business.

---

## 14. Coupons

Menu: **Coupons**. You can see the coupons and which orders used them. Creating or changing coupons needs extra permission from the Admin.

---

## 15. Extra features (only if the Admin allows)

If the Admin gave you these permissions, the matching menu or buttons will appear:

- **Cancel order:** click **Cancel order** and write a reason. Stock comes back automatically. Coupon use is **not** given back.
- **Edit order information:** change the contact name, phone, address, postal code, **delivery instructions for the courier** and the **internal note (staff only)**. Do this **before** creating the shipment.
- **Mark COD collected / Mark not recoverable:** for delivered COD orders where the money isn't marked collected.
- **Reports:** sales, orders, payments, products, customers, shipments, coupons, with CSV export.
- **Audit Log:** the history of who did what.
- **Homepage / Campaigns:** edit banners and sections, schedule them with Starts at/Ends at, and use Preview before going live. Always add desktop **and** mobile images.
- **Courier Settings:** enable or disable couriers.
- **Coupons:** create or edit coupon codes (percentage or fixed discount, minimum order, usage limits, dates).

---

## 16. Daily routine checklist

- [ ] Open the **Dashboard**.
- [ ] **Awaiting bKash verification:** verify, then confirm.
- [ ] **COD awaiting confirmation:** risk check, phone, then confirm.
- [ ] Pack confirmed orders → **Create shipment** → hand over → **Mark as shipped**.
- [ ] Fix ⚠️ cards: failed shipments, courier attention, parcels not moving.
- [ ] Follow up on **Payment rejected** customers.
- [ ] Update stock when new items arrive.
- [ ] **Logout** at the end of the day.

---

## 17. What to do if…

| Problem | What to do |
| --- | --- |
| I don't see a menu or button | You don't have permission, or the order isn't at that step yet. Ask the Admin if needed. |
| "You do not have permission to do this" | Ask the Admin to give you that permission. |
| Wrong bKash amount | **Reject payment** → "Incorrect amount", then phone the customer. |
| Customer changes their address | Edit order information (needs permission) *before* creating the shipment, or ask the Admin. |
| Customer wants a different item | It must be cancelled and re-ordered. Cancel it if you have permission, or ask the Admin. |
| Shipment failed | Section 10. Check the courier panel first if warned. |
| HIGH RISK customer | Tell the Admin before confirming. |
| "Risk check is not configured." | Tell the Admin. The BD Courier key needs to be set on the server. |
| UNKNOWN for a customer who has ordered many times | Run the check again (see the 6 November 2026 update in Section 9). |
| I forgot my password | Ask the Admin to reset it. |
| Login locked | Wait for the countdown, then try again. |

---

*Frabrilike · https://frabrilike.com*
