# Storefront Build Summary (Specs 07, 08, 09, 11)

## What's Been Built ✅

### Backend Foundation
- ✅ Customer validation schemas (registration, login, password recovery, profile, guest checkout)
- ✅ Customer auth service layer (skeleton with TODOs for OTP/reset token flows)
- ✅ Customer auth controllers (login, register, logout, me, refresh, OTP handlers)
- ✅ Customer auth routes configured (`/api/customer/auth/*`)
- ✅ Customer session constants added (cookies for customer scope)

### Frontend Pages
- ✅ **Authentication Pages:**
  - Login page at `/auth/login` with LoginForm component
  - Registration page at `/auth/register` with RegisterForm component
  - Account dashboard at `/account` linking to profile/addresses/orders/password

- ✅ **Catalogue Pages (Skeleton):**
  - Products browse page at `/products`
  - Product detail page at `/products/[id]`

- ✅ **Transaction Pages (Skeleton):**
  - Shopping cart page at `/cart`
  - Checkout page at `/checkout`

### Frontend Components
- ✅ `LoginForm` — Phone + password form with validation and error handling
- ✅ `RegisterForm` — Phone + password + confirmation with client-side validation

### Documentation
- ✅ `BUILD_STATUS.md` — Comprehensive checklist of all work (built + remaining)
- ✅ Implementation plan from fork agent (design phase complete)

---

## What Still Needs Implementation ❌

### High Priority (Blocking Other Work)

#### Backend - Customer Auth Service Completion
1. **Password Recovery Flow**
   - Implement `requestPasswordResetOtp()` — Generate OTP, store in DB, send via email
   - Implement `verifyPasswordResetOtp()` — Validate OTP, generate reset token
   - Implement `resetPassword()` — Verify token, update password hash
   - Implement OTP rate limiting (3 requests per 15 min, 5 attempts per OTP)

2. **Refresh Token Management**
   - Create `customer_refresh_tokens` table
   - Implement `generateRefreshToken()` and storage
   - Implement `verifyRefreshToken()` validation
   - Handle token rotation and invalidation

3. **Password Hashing Integration**
   - Use bcrypt (BCRYPT_COST = 12) for password hashing
   - Integrate bcrypt into register/login services
   - Hash password before storing in users table

#### Backend - API Integration
1. **Mount Routes in Main App**
   - Add customer auth routes to `backend/src/routes/index.ts`
   - Add rate limiters for login/OTP endpoints
   - Test cookie-based session flow

2. **Public Catalogue Endpoints**
   - GET `/api/public/products?search=&category=&sort=&page=`
   - GET `/api/public/products/:id`
   - GET `/api/public/categories`

3. **Customer-Only Endpoints**
   - GET `/api/customer/profile` — Get profile
   - PATCH `/api/customer/profile` — Update profile
   - POST `/api/customer/change-password` — Change password
   - GET `/api/customer/addresses` — List addresses
   - POST/PATCH/DELETE `/api/customer/addresses/:id` — Manage addresses
   - GET `/api/customer/orders` — Order history
   - GET `/api/customer/orders/:id` — Order detail

4. **Guest Lookup & Checkout**
   - POST `/api/public/orders/lookup` — Guest order lookup (rate-limited)
   - POST `/api/orders/create` — Order creation (guest + registered)
   - POST `/api/orders/:id/submit-payment` — Payment submission

### Medium Priority (Enables Frontend Features)

#### Frontend - Auth Pages Completion
1. **Forgot Password Flow**
   - Create `/auth/forgot-password/page.tsx` — Email input
   - Create `/auth/verify-otp/page.tsx` — OTP verification
   - Create `/auth/reset-password/[token]/page.tsx` — New password

2. **Account Management Pages**
   - `/account/profile/page.tsx` — Edit profile with Bangladesh geography selector
   - `/account/addresses/page.tsx` — Manage delivery addresses
   - `/account/change-password/page.tsx` — Change password form
   - `/account/orders/page.tsx` — Order history with pagination

3. **Logout Flow**
   - Implement logout button on account page
   - Call `/api/customer/auth/logout` endpoint
   - Clear cookies and redirect to homepage

#### Frontend - Utility Components
1. **Bangladesh Geography Selector**
   - Component for Division → District → Upazila/Thana → Union/Ward
   - Load geography data from `/api/geography`
   - Handle rural vs urban discriminator

2. **Address Form Component**
   - Reusable form for creating/editing addresses
   - Integrates geography selector
   - Phone number formatting for Bangladesh numbers

3. **Cart Management (`lib/cart.ts`)**
   - `useCart()` hook
   - localStorage persistence
   - addItem, removeItem, updateQuantity, getTotal operations
   - Cart format: `{items: [{productId, variantId, quantity}]}`

4. **Wishlist Management (`lib/wishlist.ts`)**
   - `useWishlist()` hook
   - localStorage persistence
   - toggleWishlist, isWishlisted operations

#### Frontend - Product Pages
1. **Products Browse Page** (`/products`)
   - Fetch from `/api/public/products?search=&category=&page=`
   - Search input with debouncing
   - Category filter sidebar
   - Sort options (newest, price low-to-high, etc.)
   - Pagination
   - SEO: og:title, og:description, canonical with params

2. **Product Detail Page** (`/products/[id]`)
   - Fetch product from `/api/public/products/:id`
   - Image carousel
   - Variant selector (Size, Color, etc.)
   - Stock availability indicator
   - Add to cart button (updates localStorage cart)
   - Add to wishlist toggle (heart icon)
   - Related products carousel
   - SEO: Product schema (JSON-LD), og:image, og:title

3. **Cart Page** (`/cart`)
   - Load cart from localStorage
   - Display items with product name, variant, price
   - Quantity +/- buttons
   - Remove item button
   - Empty cart message
   - Subtotal, tax, total calculations
   - Proceed to checkout button

4. **Wishlist Page** (`/wishlist`)
   - Load from localStorage
   - Display wishlisted products
   - Move to cart button
   - Remove from wishlist button

#### Frontend - Checkout Flow
1. **Checkout Page** (`/checkout`)
   - Branching logic for guest vs registered
   - Multi-step flow:
     - Step 1: Address (guest form or registered selector)
     - Step 2: Payment method (bKash or COD radio buttons)
     - Step 3: Apply coupon (optional)
     - Step 4: Review & place order

2. **Guest Checkout Form**
   - Full name, phone, email (optional), address fields
   - Bangladesh geography selector
   - Validation matching backend rules

3. **Payment Method Components**
   - Radio buttons for bKash / COD
   - bKash: Show merchant number, TxID + screenshot upload
   - COD: Show confirmation message

4. **Coupon Input Component**
   - Input field + Apply button
   - Calls `/api/public/coupons/validate` endpoint
   - Displays discount if applied
   - Remove coupon link

5. **Order Confirmation Page** (`/order-confirmation/[orderId]`)
   - Fetch order from `/api/customer/orders/:id` or guest lookup
   - Display order number prominently
   - Status, payment status, total
   - Delivery address summary
   - Shipment info (when available)
   - Tracking link (when available)
   - Print invoice button

### Lower Priority (Polish)

1. **API Client Extensions** (`lib/apiClient.ts`)
   - `apiCustomerLogin`, `apiCustomerRegister`, `apiCustomerLogout`
   - `apiGetProfile`, `apiUpdateProfile`
   - `apiGetAddresses`, `apiAddAddress`, `apiUpdateAddress`, `apiDeleteAddress`
   - `apiGetOrders`, `apiGetOrderDetail`
   - `apiCreateOrder`, `apiSubmitPayment`

2. **Customer Context/Provider**
   - `CustomerProvider` wrapping app
   - `useCustomer()` hook for accessing logged-in user state
   - Load profile on mount
   - Persist login state across page refreshes

3. **Header Navigation Update**
   - Add profile icon (login/account/logout menu)
   - Add cart icon with item count badge
   - Add wishlist icon

4. **Error Pages**
   - 404 page for product not found
   - 410 page for expired password reset token

5. **SEO Implementation**
   - Product schema (JSON-LD)
   - og:image, og:title, og:description on all pages
   - Proper canonical URLs with pagination/filter params

6. **Testing**
   - Backend: Spec 08 auth tests, Spec 07 catalogue tests, Spec 11 checkout tests
   - Frontend: Integration tests for login/register, checkout, product browsing

---

## Implementation Recommendations

### Phase 1: Complete Backend Auth (Est. 2-3 hours)
1. Implement OTP flow (request, verify, reset)
2. Add refresh token table and logic
3. Integrate bcrypt hashing
4. Test login/register/forgot-password flows end-to-end
5. Mount routes in app and verify cookie handling

### Phase 2: Complete Frontend Auth (Est. 2-3 hours)
1. Build forgot-password pages
2. Build profile/addresses/password management pages
3. Implement logout flow
4. Add Bangladesh geography selector component
5. Build address form component
6. Test auth flows in browser

### Phase 3: Catalogue & Cart (Est. 3-4 hours)
1. Implement product search/detail backend endpoints
2. Complete product browse and detail frontend pages
3. Implement cart state management (localStorage)
4. Build cart page with product list and checkout button
5. Add to cart functionality on product detail page

### Phase 4: Checkout (Est. 4-5 hours)
1. Implement `/api/orders/create` with validation and transaction wrapping
2. Implement payment submission endpoint
3. Complete checkout page with address/payment selection
4. Build order confirmation page
5. Test full checkout flow (guest and registered)

### Phase 5: Polish & Testing (Est. 2-3 hours)
1. Add SEO metadata (og:image, schema markup)
2. Build error pages
3. Add header navigation updates
4. Write integration tests
5. Test edge cases (expired tokens, invalid coupons, etc.)

---

## Files Already Created

**Backend:**
- `backend/src/validation/customer.validation.ts` — Zod schemas
- `backend/src/routes/customer/auth.routes.ts` — Route definitions
- `backend/src/controllers/customerAuth.controller.ts` — Handler skeleton
- `backend/src/services/customer.service.ts` — Service skeleton (many TODOs)
- `backend/src/config/constants.ts` — Updated with customer cookie names

**Frontend:**
- `frontend/src/app/auth/login/page.tsx`
- `frontend/src/app/auth/register/page.tsx`
- `frontend/src/app/account/page.tsx`
- `frontend/src/app/products/page.tsx`
- `frontend/src/app/products/[id]/page.tsx`
- `frontend/src/app/cart/page.tsx`
- `frontend/src/app/checkout/page.tsx`
- `frontend/src/components/auth/LoginForm.tsx`
- `frontend/src/components/auth/RegisterForm.tsx`
- `frontend/src/lib/constants.ts`

**Documentation:**
- `BUILD_STATUS.md` — Detailed checklist
- `STOREFRONT_BUILD_SUMMARY.md` — This file

---

## Testing Checklist

### Backend Tests (Vitest)
- [ ] Spec 08: Customer registration (success, duplicate phone, validation)
- [ ] Spec 08: Login (success, wrong password, phone not found, rate limiting)
- [ ] Spec 08: Password recovery (request OTP, verify OTP, reset password)
- [ ] Spec 07: Product search/filter
- [ ] Spec 11: Order creation (guest, registered, validation, idempotency)
- [ ] Spec 11: Payment submission

### Frontend Tests
- [ ] Login/register flow end-to-end
- [ ] Profile/addresses management
- [ ] Product browsing with search/filter
- [ ] Add to cart functionality
- [ ] Checkout flow (guest and registered paths)
- [ ] Order confirmation

### Manual Testing (Browser)
- [ ] Session persistence across page refreshes
- [ ] Logout clears cookies properly
- [ ] Cart persists in localStorage
- [ ] Rate limiting shows appropriate messages
- [ ] SEO metadata present on pages
- [ ] Mobile responsiveness

---

## Known Limitations / TODOs

1. **Email Service** — OTP and password reset emails not yet integrated
2. **Upload Service** — Screenshot upload for bKash payment not implemented
3. **Address Book** — Full address management endpoints not started
4. **Geography Data** — Load geography list from `/api/geography` (may already exist)
5. **Idempotency** — Order idempotency key implementation needed in backend
6. **Error Localization** — Error messages in English only (could add Bengali later)

---

## Current Status

**Build Stage:** Foundation Phase Complete, Implementation Phase In Progress

- ✅ Architecture designed (specification from fork agent)
- ✅ Database schema exists (customers table with address model)
- ✅ Frontend page structure created (all main pages)
- ✅ Backend skeleton created (validation, services, routes)
- 🚧 Backend auth service needs completion (OTP, refresh tokens)
- 🚧 Frontend pages need API integration (mostly marked as TODO)
- ❌ Catalogue endpoints not started
- ❌ Checkout endpoints not started
- ❌ Full integration testing not started

**Next Step:** Complete backend customer auth service, then integrate with frontend pages.
