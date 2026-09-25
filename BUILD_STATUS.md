# Storefront Build Status (Specs 07, 08, 09, 11)

## Summary
Building customer-facing storefront pages following the implementation plan from the fork agent. This document tracks what's built and what remains.

---

## BACKEND - Customer Auth (Spec 08)

### ✅ Complete
- [x] Database schema (migrations 0001-0002): customers, users tables with discriminated Bangladesh address model
- [x] Types: `CustomerRecord`, `CustomerAddress`, `UserRecord`, `UserWithSecret`
- [x] Repositories: `customers.repository.ts`, `users.repository.ts` with all CRUD operations
- [x] Constants: Added `CUSTOMER_ACCESS_COOKIE`, `CUSTOMER_REFRESH_COOKIE`

### 🚧 In Progress
- [ ] Validation schemas: `backend/src/validation/customer.validation.ts` (created but needs testing)
- [ ] Auth controllers: `backend/src/controllers/customerAuth.controller.ts` (skeleton, incomplete)
- [ ] Auth service: `backend/src/services/customer.service.ts` (skeleton, many TODOs)
- [ ] Auth routes: `backend/src/routes/customer/auth.routes.ts` (created but not integrated)

### ❌ Not Started
- [ ] OTP/password reset flow (request-otp, verify-otp, reset-password services)
- [ ] Refresh token storage & verification
- [ ] Rate limiting configuration for customer login/OTP
- [ ] Customer profile routes (`/api/customer/profile/*`)
- [ ] Customer address routes (`/api/customer/addresses/*`)
- [ ] Customer orders routes (`/api/customer/orders/*`)
- [ ] Guest order lookup route (`/api/public/orders/lookup`)

---

## BACKEND - Catalogue (Spec 07)

### ✅ Complete
- [x] Database schema: products, categories, variants
- [x] Admin catalogue routes & controllers

### ❌ Not Started
- [ ] Public products route: GET `/api/public/products?search=&category=&sort=&page=`
- [ ] Public product detail route: GET `/api/public/products/:id`
- [ ] Public categories route: GET `/api/public/categories`

---

## BACKEND - Cart & Checkout (Specs 09, 11)

### ✅ Complete
- [x] Database schema: orders, payments, shipments (from earlier specs)

### ❌ Not Started
- [ ] Cart endpoint (optional - frontend may use localStorage)
- [ ] Order creation route: POST `/api/orders/create` with:
  - Registered customer validation (profile completeness)
  - Guest checkout validation
  - Cart validation (items still available, prices current)
  - Coupon revalidation & application
  - Transaction wrapping (spec 03 requirement)
  - Idempotency key dedup
- [ ] Payment submission route: POST `/api/orders/:id/submit-payment`
- [ ] Guest order lookup route: POST `/api/public/orders/lookup` with rate-limiting

---

## FRONTEND - Customer Auth Pages (Spec 08)

### ❌ Not Started
- [ ] `/auth/login/page.tsx` — Login form
  - phone + password inputs
  - Error handling + rate-limit feedback
  - Redirect to account on success
  - Link to forgot-password

- [ ] `/auth/register/page.tsx` — Registration form
  - phone + password + confirm-password inputs
  - Validation (8+ chars, at least one digit, etc.)
  - Error handling
  - Redirect to login on success

- [ ] `/auth/forgot-password/page.tsx` — OTP request
  - Email input
  - Submit to request OTP
  - Transition to verify-otp form in same component or modal

- [ ] `/auth/verify-otp/page.tsx` — OTP verification
  - OTP code input (6 digits)
  - Submit OTP
  - On success, show reset-password form

- [ ] `/auth/reset-password/[token]/page.tsx` — New password
  - new password + confirm inputs
  - Submit new password
  - Redirect to login

- [ ] `/account/page.tsx` — Account dashboard
  - Customer profile summary
  - Links to profile edit, addresses, change password, order history
  - Logout button

- [ ] `/account/profile/page.tsx` — Edit profile
  - full_name, email, division, district, upazila/thana, union/ward, detailed_address, postal_code
  - Bangladesh geography selector component (reuse from admin if exists)
  - Save changes, error handling

- [ ] `/account/addresses/page.tsx` — Manage delivery addresses
  - List of saved addresses
  - Add new address button
  - Edit/delete per address
  - Set default address

- [ ] `/account/change-password/page.tsx` — Change password
  - Current password, new password, confirm
  - Submit, error handling, success message

- [ ] `/account/orders/page.tsx` — Order history
  - Paginated list of customer's orders
  - Order number, date, status, total
  - Click to view detail

---

## FRONTEND - Catalogue Pages (Spec 07)

### ✅ Partial
- [x] `/page.tsx` (homepage) — CMS-driven, exists
- [x] ProductCard component — exists

### ❌ Not Started
- [ ] `/products/page.tsx` — Browse/search products
  - Search input
  - Category filter (sidebar or dropdown)
  - Sort options (name, price, newest)
  - Product grid with ProductCard
  - Pagination
  - SEO metadata

- [ ] `/products/[category]/page.tsx` — Category browse
  - Same as products page, filtered by category
  - Category header/banner
  - SEO metadata (og:title, etc. with category name)

- [ ] `/products/[id]/page.tsx` — Product detail
  - Product images (carousel)
  - Name, price, description
  - Variant selector (Size, Color, etc.) with stock availability
  - Add to cart button
  - Add to wishlist button (toggle heart icon)
  - Related products carousel
  - SEO: og:image, og:title, og:description, json-ld schema

- [ ] `components/products/ProductFilter.tsx` — Category/sort filter component
- [ ] `components/products/VariantSelector.tsx` — Size/color selector with stock check
- [ ] `components/products/RelatedProducts.tsx` — Related products carousel

---

## FRONTEND - Cart & Wishlist (Spec 09)

### ❌ Not Started
- [ ] `/cart/page.tsx` — Shopping cart
  - Quantity +/- for each item
  - Remove item button
  - Subtotal, tax (if applicable), total
  - Proceed to checkout button
  - Continue shopping button

- [ ] `/wishlist/page.tsx` — Wishlist
  - List of wishlisted products
  - Move to cart button per item
  - Remove button
  - Empty wishlist message

- [ ] `lib/cart.ts` — Cart state management
  - `useCart()` hook for React components
  - localStorage persistence
  - cart format: `{items: [{productId, variantId, quantity}]}`
  - addItem, removeItem, updateQuantity, clearCart, getTotal

- [ ] `lib/wishlist.ts` — Wishlist state management
  - `useWishlist()` hook
  - localStorage persistence
  - toggleWishlist, isWishlisted

- [ ] Cart API client functions in `lib/apiClient.ts` or separate

---

## FRONTEND - Checkout Flow (Spec 11)

### ❌ Not Started
- [ ] `/checkout/page.tsx` — Main checkout flow
  - Step 1: Review cart items
  - Step 2: Delivery address (guest or registered)
  - Step 3: Payment method selection
  - Step 4: Apply coupon code (optional)
  - Step 5: Review & place order

- [ ] `components/checkout/GuestCheckoutForm.tsx`
  - full_name, phone_number, email (optional), address fields
  - Bangladesh geography selector
  - Validation errors per field

- [ ] `components/checkout/RegisteredCheckoutForm.tsx`
  - Load from customer profile
  - Show if profile complete, redirect if missing info
  - Offer to use different saved address

- [ ] `components/checkout/PaymentMethodSelect.tsx`
  - Radio: bKash or COD
  - Show instructions per method

- [ ] `components/checkout/BkashPaymentForm.tsx`
  - Display merchant bKash number
  - Payment instructions
  - Transaction ID input
  - Optional screenshot upload
  - Submit payment info button

- [ ] `components/checkout/CodConfirmation.tsx`
  - Message: "Our customer-care representative will call to confirm"
  - Confirm button

- [ ] `components/checkout/CouponInput.tsx`
  - Coupon code input
  - Apply button
  - Discount display
  - Remove coupon link

- [ ] `/order-confirmation/[orderId]/page.tsx`
  - Order number prominently displayed
  - Order status (Pending Confirmation, etc.)
  - Payment status
  - Delivery address
  - Shipment info (when available)
  - Tracking link (when available)
  - Next steps message
  - Print invoice button (optional)

---

## FRONTEND - Shared Components & Utilities

### ❌ Not Started
- [ ] `components/address/AddressForm.tsx` — Reusable address form
  - full_name, phone, address fields
  - Bangladesh geography selector
  - Inline validation

- [ ] `components/address/GeographySelect.tsx` — Bangladesh geography dropdown
  - Division selector
  - District selector (depends on division)
  - Upazila/Thana dropdown with type discriminator
  - Union/Ward dropdown with type discriminator
  - Load geography data from `/api/geography` endpoint

- [ ] `components/checkout/CouponInput.tsx` — Coupon code input
  - Input with Apply button
  - Shows discount if applied
  - Remove button
  - Calls `/api/public/coupons/validate` endpoint

- [ ] `components/layout/Header.tsx` — Update with customer nav
  - Profile icon (login/logout/account menu)
  - Cart icon with item count
  - Wishlist icon

- [ ] `lib/phone.ts` — Bangladesh phone formatting
  - normalizeBdPhone: convert +880... or 0... to 01...
  - formatBdPhone: format 01XXXXXXXXX for display

- [ ] `lib/types/customer.ts` — Frontend customer types
  - Customer, CustomerAddress, LoginRequest, RegisterRequest, etc.

- [ ] `lib/apiClient.ts` — Extend with customer auth functions
  - `apiCustomerLogin`, `apiCustomerRegister`, `apiCustomerLogout`
  - `apiGetProfile`, `apiUpdateProfile`
  - `apiGetAddresses`, `apiAddAddress`, etc.

- [ ] Customer context/provider for managing logged-in state
  - `CustomerProvider`, `useCustomer()` hook
  - Load profile on mount, keep in context
  - Set token in cookie

---

## FRONTEND - SEO & Metadata

### ❌ Not Started
- [ ] Product detail page SEO:
  - generateMetadata() with product name, description, image
  - JSON-LD structured data (Product schema)
  - og:image with product image

- [ ] Category page SEO:
  - generateMetadata() with category name
  - og:title, og:description, canonical URL

- [ ] Products browse page SEO:
  - Meta with search/filter params in title/description
  - Canonical URL (handle pagination/filters correctly)

---

## TESTING

### ❌ Not Started
- [ ] Spec 08 backend tests (`backend/tests/spec-08-customer-auth/`)
  - Registration (success, phone exists, validation)
  - Login (success, wrong password, phone not found)
  - Password recovery flow
  - Rate limiting

- [ ] Spec 07 backend tests
  - Product search/filter
  - Category listing
  - Product detail retrieval

- [ ] Spec 11 backend tests
  - Order creation (guest, registered, validation)
  - Idempotency key dedup
  - Coupon revalidation
  - Payment submission

- [ ] Frontend integration tests (if using)
  - Login/register flow
  - Checkout flow (both paths)
  - Product browsing
  - Cart operations

---

## INTEGRATION CHECKLIST

- [ ] Mount customer auth routes in main app
- [ ] Mount public products/categories routes
- [ ] Mount checkout/orders routes
- [ ] Add customer auth middleware to requireAuth()
- [ ] Update main routes/index.ts to include new routers
- [ ] Ensure rate limiters are configured for all new endpoints
- [ ] Test cookie-based session (httpOnly, same-site, secure)
- [ ] Test CSRF protection (customer routes don't need it, but check)
- [ ] Verify error responses are consistent with API error format

---

## PRIORITY ORDER (Recommended Implementation)

1. **Spec 08 Backend** — Login/register/forgot-password services, controllers, routes
2. **Spec 08 Frontend** — Login, register, profile pages (unblock all subsequent work)
3. **Spec 07 Backend** — Public product search/detail routes
4. **Spec 07 Frontend** — Product browse, detail, category pages
5. **Spec 09 Frontend** — Cart & wishlist (localStorage-based)
6. **Spec 11 Backend** — Order creation, payment submission
7. **Spec 11 Frontend** — Checkout flow, order confirmation
8. **SEO & Polish** — Meta tags, structured data, edge cases

---

## Known Issues / TODOs

- OTP flow is stubbed (request-otp, verify-otp, reset-password)
- Refresh token storage not implemented (placeholder only)
- Rate limiter configuration for customer endpoints not complete
- Guest order lookup endpoint not started
- Email sending service not integrated
- Upload screenshots for bKash payment not implemented
- Address book (multiple addresses per customer) routes not started
- Change password endpoint handler incomplete
- Product search/filter backend endpoint not started

