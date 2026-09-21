---
name: design
description: Visual/UX design system for this Bangladesh e-commerce platform — exact page and component layouts, colour palette, typography, spacing, breakpoints, and accessibility rules for the customer storefront and Admin/Manager back-office. Read before building or restyling any page or component, per .claude/project requirment documents/ and .claude/skills/design/
type: skill
version: 1.0
languages:
  - en
priority: high
---

# 🎨 E-Commerce Design Skill

**For**: Bangladesh Fashion & Clothing E-Commerce Platform  
**Status**: Complete Design System  
**Version**: 1.0  

---

## ⚡ DESIGN FIRST PRINCIPLES

### 1. **Mobile-First Design**
- 95% of users are mobile
- Design starts at 375px width
- Test at 320px (ensure fit)
- Enhance at 768px+, 1024px+
- Desktop is secondary enhancement

### 2. **English-Only UI**
- **ALL UI text must be in English**
- Navigation, buttons, forms, messages, all labels
- No Bangla UI text (unless explicitly requested)
- User-generated content and translations may vary

### 3. **Professional, Not "AI Slope"**
**DO:**
- Clean, simple layouts
- High contrast text
- Generous whitespace
- Professional colors (red, dark gray, green)
- Simple icons
- Clear typography
- Functional design
- Fast performance

**DON'T:**
- Gradient backgrounds
- Blur/glass morphism effects
- Neumorphism
- Heavy shadows
- Fancy animations
- Decorative fonts
- Excessive rounded corners
- Trendy "modern" design

**Reference**: Daraz, Rokomari, Chaldal (proven local e-commerce designs)

### 4. **Real E-Commerce UX**
The complete customer journey must be simple and obvious:
```
Home → Categories → Product Listing → Product Details → 
Size Selection → Add to Cart → Cart → Checkout → 
Payment (bKash/COD) → Order Confirmation → Order Tracking
```

### 5. **Bangladesh-Focused**
Design decisions support:
- Bengali payment methods (bKash manual, COD)
- Bangladesh shipping (Pathao, Steadfast, Courier APIs)
- Local address formats (Division, District, Upazila)
- Transaction ID verification
- Payment screenshot upload
- Parcel tracking

---

## 🎨 DESIGN SYSTEM

### Color Palette

#### Primary Colors
```
Primary Action (Red):    #DC143C
  └─ Buttons, links, key CTAs
  └─ Bold and visible on mobile
  └─ Professional, trusted

Secondary (Dark Gray):   #1F2937
  └─ Text, structure, backgrounds
  └─ High contrast on white
  └─ Professional appearance

Accent (Emerald Green):  #059669
  └─ Success states, confirmations
  └─ Positive actions
  └─ Different from primary
```

#### Supporting Colors
```
Success (Light Green):   #10B981 - Confirmations, success messages
Error (Deep Red):        #DC2626 - Errors (distinct from primary)
Warning (Amber):         #F59E0B - Pending, caution states
Info (Sky Blue):         #0EA5E9 - Information messages
```

#### Neutral Colors
```
Background:              #FFFFFF - Pure white, clean
Surface:                 #F9FAFB - Card backgrounds, sections
Text Primary:            #111827 - Main text (maximum contrast)
Text Secondary:          #6B7280 - Helper text, labels
Text Tertiary:           #9CA3AF - Hints, disabled
Border:                  #E5E7EB - Section dividers
```

### Typography

#### Font Family
```
English:  Inter (Google Fonts)
          → font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif

Why Inter?
- Clean, modern, highly readable on mobile
- Excellent at small sizes
- Professional appearance
- Fast loading from Google Fonts
```

#### Font Sizes (Mobile First)
```
Mobile          →  Desktop
─────────────────────────
H1:  28px       →  36px   (page title)
H2:  20px       →  28px   (section title)
H3:  18px       →  24px   (subsection)
H4:  16px       →  20px   (heading)

Body:    14px   →  16px   (main text)
Small:   12px   →  14px   (secondary text)
Label:   12px   →  12px   (form labels)
```

#### Font Weights
```
400: Regular body text
500: Form labels, medium emphasis
600: Subheadings, button text
700: Headings, bold text
```

#### Line Heights
```
Headings:      1.3 (compact, strong hierarchy)
Body text:     1.6 (readable, especially on mobile)
Form labels:   1.4 (balanced)
```

#### Letter Spacing
```
Normal (0): All text
Why? Extra spacing looks "designed" and wastes mobile space
```

### Spacing System (Base Unit: 4px)

```
xs:   4px    (minimal spacing)
sm:   8px    (small gaps)
md:   12px   (default element spacing)
lg:   16px   (section spacing, card padding)
xl:   20px   (larger sections)
2xl:  24px   (major sections)
3xl:  32px   (full-width page padding)
```

**Mobile Layout Spacing:**
- Page/Container sides: 16px
- Card/Section: 16px internal padding
- Element spacing: 12px
- Tight spacing: 8px

---

## 🧩 COMPONENT SPECIFICATIONS

### Buttons

#### Primary Button
```
Height:         44px minimum (touch target)
Width:          100% on mobile, auto on desktop
Background:     #DC143C (red)
Text:           White, 14px bold
Border-radius:  8px
Padding:        12px 16px (internal)
No shadows
Tap area:       48x48px minimum

States:
├─ Normal: #DC143C
├─ Hover (desktop): #B01030 (darker red)
├─ Active: #A00E2A (even darker)
├─ Disabled: 50% opacity + cursor: not-allowed
└─ Loading: Spinner inside, text hidden
```

#### Secondary Button
```
Height:         44px minimum
Width:          100% on mobile, auto on desktop
Background:     #FFFFFF (white)
Border:         2px #DC143C
Text:           #DC143C, 14px bold
Border-radius:  8px
No shadows

States:
├─ Normal: White bg, red border
├─ Hover (desktop): #F9FAFB bg
├─ Active: #F3F4F6 bg
└─ Disabled: 50% opacity
```

#### Destructive Button
```
Height:         44px minimum
Background:     #DC2626 (deep red)
Text:           White, 14px bold
Tap area:       48x48px minimum
Different from primary red to avoid accidental clicks

States:
├─ Normal: #DC2626
├─ Hover: #B91C1C
├─ Disabled: 50% opacity
```

### Form Inputs

#### Text Input / Email / Tel
```
Height:         44px minimum (48px+ with padding)
Width:          100% on mobile
Font-size:      16px (prevents mobile zoom)
Padding:        12px (internal)
Border:         1px #E5E7EB
Border-radius:  8px
Background:     #FFFFFF
Text color:     #111827

Focus state:
├─ Border: 2px #DC143C
├─ Outline: none
└─ Shadow: none (clean)

Error state:
├─ Border: 2px #DC2626
├─ Error text below: 12px red
└─ Icon: optional red X

Success state:
├─ Border: 2px #10B981
└─ Icon: green checkmark

Disabled state:
├─ Background: #F9FAFB
├─ Opacity: 50%
└─ Cursor: not-allowed
```

#### Textarea
```
Height:         120px minimum
Width:          100%
Font-size:      16px
Padding:        12px
Border:         1px #E5E7EB
Border-radius:  8px
Resize:         vertical (optional)

Same states as text input
```

#### Select/Dropdown
```
Height:         44px minimum
Width:          100% on mobile
Font-size:      16px
Padding:        12px
Border:         1px #E5E7EB
Border-radius:  8px
Chevron icon:   Right side

Focus state:
└─ Border: 2px #DC143C

Options:
├─ Background: #FFFFFF
├─ Hover background: #F9FAFB
├─ Text: 14px #111827
└─ Padding: 12px
```

#### Checkbox
```
Size:           20x20px minimum
Padding:        8px around (28x28px tap area)
Border:         1px #E5E7EB
Checked:        #DC143C background, white checkmark
Disabled:       50% opacity
Label:          14px, left-aligned, clickable
```

#### Radio Button
```
Size:           20x20px circle
Padding:        8px around (28x28px tap area)
Border:         2px #E5E7EB
Selected:       Inner circle #DC143C
Disabled:       50% opacity
Label:          14px, left-aligned, clickable
```

### Cards

```
Border-radius:  8px
Background:     #FFFFFF
Border:         1px #E5E7EB
Padding:        16px
Shadow:         0 1px 2px rgba(0, 0, 0, 0.05) (subtle)

Responsive:
├─ Mobile: Full width minus 16px sides
├─ Tablet: Flexible columns
└─ Desktop: Fixed width if needed
```

### Forms

#### Form Label
```
Font-size:      12px
Font-weight:    600
Color:          #111827
Display:        Block (above input)
Margin-bottom:  8px

Required indicator: * in red
Help text:      12px #6B7280, below label if needed
```

#### Form Group
```
Margin-bottom:  16px
Width:          100%
No multi-column on mobile
```

---

## 🧭 NAVIGATION

### Mobile Header
```
Height:         56px (iOS standard)
Background:     #FFFFFF
Border-bottom:  1px #E5E7EB

Layout:
├─ Left (20px):   Hamburger (24px icon) or Back button
├─ Center:        Logo (max 28px tall, centered)
└─ Right (20px):  Cart icon + badge, or Search icon

Cart badge:
├─ Size: 12x12px
├─ Background: #DC143C
├─ Text: white, 10px, centered
└─ Position: top-right of icon
```

### Bottom Navigation Tab (RECOMMENDED)
```
Height:         56px (fixed at bottom)
Background:     #FFFFFF
Border-top:     1px #E5E7EB
Layout:         5 equal tabs
Tap area:       56x56px each

Tabs:
├─ Home (home icon, label)
├─ Categories (grid icon, label)
├─ Search (search icon, label)
├─ Cart (cart icon, badge, label)
└─ Account (person icon, label)

Active:         Icon #DC143C, label #DC143C, underline
Inactive:       Icon #6B7280, label #6B7280, gray

Why bottom nav?
- Thumb-friendly
- Always accessible
- Clear navigation
- Professional mobile pattern
```

### Hamburger Menu Drawer
```
Position:       Full-screen slide from left
Width:          80% of viewport
Background:     #F9FAFB
Overlay:        Semi-transparent black, tap to close

Header:
├─ Close button: Large X top-right, 32x32px
└─ Logo or "Menu" title

Menu items:
├─ Height: 48px each
├─ Padding: 16px horizontal
├─ Text: 16px #111827
├─ Border-bottom: 1px #E5E7EB
└─ Tap area: Full width

Content:
├─ Categories section
├─ Customer section (if logged in)
│  ├─ My Orders
│  ├─ Wishlist
│  ├─ Account Settings
│  └─ Logout
└─ Help section
   ├─ Contact
   ├─ Help
   └─ About
```

### Navigation Links (General)
```
Text:           16px
Color:          #1F2937
Active:         #DC143C, bold
Visited:        #6B7280 (optional)
Hover:          #DC143C (desktop only)
Padding:        12px 16px
```

---

## 📱 RESPONSIVE BREAKPOINTS (Mobile First)

```
Mobile Small:   320px   (min support)
Mobile:         375px   (base design here)
Mobile Large:   425px
Tablet:         768px   (md: breakpoint)
Desktop:        1024px  (lg: breakpoint)
Desktop Large:  1280px  (xl: breakpoint)
Extra Large:    1536px  (2xl: breakpoint)
```

**Strategy:**
1. Design and code at 375px (standard mobile)
2. Test at 320px (ensure everything fits)
3. Enhance at 768px+ if time permits
4. Desktop layout is minimal enhancement

### Mobile-First CSS Pattern
```css
/* Mobile first (375px) */
.container {
  width: 100%;
  padding: 16px;
}

/* Enhance for tablet */
@media (min-width: 768px) {
  .container {
    width: 90%;
    max-width: 700px;
  }
}

/* Enhance for desktop */
@media (min-width: 1024px) {
  .container {
    width: 80%;
    max-width: 1200px;
  }
}
```

---

## 🛒 CUSTOMER STOREFRONT PAGES

### Homepage
```
Layout (Mobile):
1. Top header (56px)
2. Hero banner (full width, image or colored section)
3. Featured categories (horizontal scroll or grid)
4. Featured products (vertical scroll, cards)
5. Promotional banner (full width)
6. Latest products (grid)
7. Bottom navigation (56px)

Hero banner:
├─ Aspect ratio: 4:3 or 5:3
├─ Full width, no padding
├─ Image or solid color
└─ Optional: Text overlay (centered)

Product grid:
├─ 2 columns on mobile
├─ 3 columns on tablet
├─ 4 columns on desktop
├─ 8px gap between cards
└─ Cards stretch to fill width
```

### Product Listing Page
```
Layout (Mobile):
1. Header with search/filter toggle
2. Filter panel (hidden, drawer or collapsible)
3. Product grid (2 columns)
4. Pagination or load more
5. Bottom navigation

Filter toggle:
├─ Button in header: "Filters" + icon
├─ Shows/hides filter drawer
└─ Indicates active filters

Sort options:
├─ Dropdown in header
├─ Options: New, Price (Low to High), Price (High to Low), Rating
└─ 14px text

Product card:
├─ Image: full width, square (1:1)
├─ Name: 14px bold, 2 lines max
├─ Rating: 12px gray, optional
├─ Price: 16px red bold
├─ "Add to Cart" button: full width, 44px
└─ "Add to Wishlist" button: outline, full width, 44px
```

### Product Detail Page
```
Layout (Mobile):
1. Header with back + cart icons
2. Product image gallery (full width, swipeable)
3. Product name (20px bold)
4. Rating (optional)
5. Price (16px red bold)
6. Stock status
7. Size selection (radio buttons or size picker)
8. Color selection (if applicable)
9. Quantity selector
10. "Add to Cart" button (full width, 48px)
11. "Add to Wishlist" button (outline, full width, 44px)
12. Product description (collapsible)
13. Related products (horizontal scroll)

Image gallery:
├─ Full width, square aspect
├─ Swipe left/right to change image
├─ Indicator dots at bottom
└─ No thumbnail row (hard to tap)

Size selector:
├─ Options as buttons (44x44px minimum)
├─ Selected: #DC143C red, white text
├─ Unselected: white bg, red border
├─ Out of stock: grayed out, disabled
└─ Size as label above

Price section:
├─ Original price: 14px strikethrough gray (if on sale)
├─ Discounted price: 18px red bold
├─ Discount badge: red bg, white text (if applicable)
```

### Shopping Cart
```
Layout (Mobile):
1. Header: "Cart" title
2. Cart items list
3. Quantity adjustment per item
4. Remove button per item
5. Cart summary (sticky at bottom)
6. Checkout button (sticky)

Cart item:
├─ Image: 80x80px
├─ Name: 14px, 1 line
├─ Price: 14px red
├─ Quantity: +/- buttons with number
├─ Remove: "X" button or text link
└─ Row divider: 1px #E5E7EB

Cart summary (sticky):
├─ Subtotal: 14px gray
├─ Subtotal amount: 16px bold
├─ Shipping: 14px gray
├─ Shipping cost: 14px
├─ Tax (if applicable): 14px gray
├─ Divider: 1px #E5E7EB
├─ Grand total: 16px bold
├─ "Checkout" button: full width, 48px red
└─ "Continue Shopping" button: outline, full width, 44px
```

### Checkout - Step 1: Delivery Address
```
Layout (Mobile):
1. Progress indicator: "Step 1/3"
2. Section title: "Delivery Address"
3. Saved addresses (if exist)
   └─ Radio buttons, 48px height, full width
4. "Add New Address" button
5. Next button (sticky at bottom)

Saved address card:
├─ Radio button: left side
├─ Address text: 14px
├─ City/District: 12px gray
├─ "Edit" link: small
└─ Full width, 48px height minimum

Add address form (shown if toggled):
├─ Full Name input
├─ Phone number input
├─ Address line 1
├─ Address line 2 (optional)
├─ Division select
├─ District select
├─ Upazila select (if available)
├─ Postal code input
└─ All fields: 44px height, 100% width
```

### Checkout - Step 2: Payment Method
```
Layout (Mobile):
1. Progress indicator: "Step 2/3"
2. Section title: "Select Payment Method"
3. Payment options (large radio buttons)
4. Next button (sticky)

Option 1: bKash Send Money
├─ Radio button: 56x56px tap area
├─ Label: "bKash Send Money"
├─ Description: "Send money to our bKash account"

Option 2: Cash on Delivery
├─ Radio button: 56x56px tap area
├─ Label: "Cash on Delivery"
├─ Description: "Pay when you receive the item"

Each option: Full width, 56px height minimum
```

### Checkout - Step 3a: bKash Payment
```
Layout (Mobile):
1. Progress indicator: "Step 3/3"
2. Section title: "Complete Payment"
3. Payment instructions section
4. Merchant bKash number (highlighted)
5. Transaction ID input
6. Screenshot upload (optional)
7. Submit button (sticky)

Instructions section:
├─ Background: #F9FAFB
├─ Padding: 16px
├─ Text: 14px #111827
├─ Steps:
│  1. Open bKash app
│  2. Select "Send Money"
│  3. Enter merchant number below
│  4. Enter amount: ৳ 2,500 (show order total)
│  5. Complete transaction
│  6. Enter Transaction ID here

Merchant number:
├─ Size: 18px bold, monospace font
├─ Background: #DC143C, white text
├─ Padding: 16px
├─ Border-radius: 8px
├─ Selectable (copy to clipboard button optional)

Transaction ID input:
├─ Label: "Transaction ID *"
├─ Input: 44px height, monospace font
├─ Help text: "Find in your bKash history"

Screenshot upload:
├─ Label: "Payment Screenshot (Optional)"
├─ Upload button: 60px height, full width
├─ Text: "Tap to upload or take photo"
├─ Icon: 📷
├─ Shows filename if uploaded
```

### Checkout - Step 3b: COD Confirmation
```
Layout (Mobile):
1. Progress indicator: "Step 3/3"
2. Section title: "Confirm Order"
3. COD message section
4. Order summary
5. Terms checkbox
6. "Place Order" button (sticky)

COD message:
├─ Background: #D1FAE5 (light green)
├─ Border: 1px #059669
├─ Padding: 16px
├─ Text: 14px #065F46
├─ Message: "Our representative will call to confirm. Have ৳ [amount] ready."

Order summary:
├─ Items: 14px
├─ Quantity: 14px
├─ Total: 16px bold
└─ Delivery address: 12px gray

Terms checkbox:
├─ Checkbox: 20x20px
├─ Label: "I agree to the terms & conditions"
├─ Link: underline
└─ Required: must be checked to proceed
```

### Order Confirmation
```
Layout (Mobile):
1. Success checkmark icon (32x32px, green)
2. "Order Confirmed" title (20px bold)
3. Order number (16px red, bold, monospace)
4. Order date (12px gray)
5. Order summary card
6. Action buttons
7. Bottom navigation

Summary card:
├─ Items: "3 items"
├─ Total: "৳ 2,500"
├─ Delivery address
├─ Estimated delivery: "3-5 business days"
└─ Payment method shown

Buttons:
├─ "Continue Shopping" button: outline, full width
└─ "Track Order" button: red, full width

After confirmation:
└─ User redirected to dashboard/home
```

### Order Tracking Page
```
Layout (Mobile):
1. Header: "Order #ORD-12345"
2. Order date: "17 Sep 2026"
3. Status timeline (visual progress)
4. Current status detail
5. Tracking info (if shipped)
6. Action buttons

Timeline (vertical):
├─ ✓ Order Placed (green checkmark)
├─ ✓ Payment Verified (green checkmark)
├─ ⏳ Shipped (blue, current step)
├─ ○ In Transit (gray, future)
├─ ○ Delivered (gray, future)
└─ Connecting lines between steps

Status section:
├─ Current: "Shipped on 18 Sep 2026"
├─ Tracking info (if available)
│  ├─ Courier: "Pathao"
│  ├─ Parcel ID: "PRN-1234567"
│  └─ "Track on Pathao" link
└─ Estimated delivery: "20-22 Sep 2026"

Buttons:
├─ "Track Shipment" button: outline
└─ "Contact Support" button: outline
```

### Customer Account Page
```
Layout (Mobile):
1. Header: "My Account"
2. Account info section
3. Quick actions
4. Help section

Account info:
├─ Name: 16px bold
├─ Email: 14px gray
├─ Phone: 14px gray
└─ Member since: 12px gray

Quick actions (buttons, full width):
├─ "My Orders"
├─ "Saved Addresses"
├─ "Wishlist"
├─ "Account Settings"
└─ "Logout"

Help section:
├─ "Contact Support" link
├─ "Help Center" link
└─ "Report an Issue" link
```

---

## 🔐 ADMIN / MANAGER INTERFACE

### Admin Dashboard
```
Layout (Mobile):
1. Header with logout
2. Dashboard title
3. Metric cards (scrollable grid)
4. Recent orders section
5. Quick actions

Metric cards (60% width on mobile, scroll horizontally):
├─ Total Orders (large number, 24px)
├─ Total Revenue (currency, 18px)
├─ Pending Orders (number, 18px)
├─ Pending Verifications (number, 18px)
└─ New Customers (number, 18px)

Each card:
├─ Label: 12px gray
├─ Value: 18px bold
├─ Trend (optional): +5% (small, gray)
└─ Tap to filter or view detail

Recent orders:
├─ Table-like list
├─ Order ID: 12px monospace
├─ Customer: 14px
├─ Amount: 14px bold
├─ Status: badge
└─ Tap to open detail

Quick actions:
├─ "View Pending Orders" button
├─ "Verify Payments" button
├─ "Create Product" button
└─ Each: full width, 44px
```

### Order Management
```
Layout (Mobile):
1. Header: "Orders"
2. Filter bar (collapsed by default)
3. Status filter tabs
4. Order list

Filter bar (expandable):
├─ Search input: 44px height
├─ Date range (optional)
├─ Status filter: checkboxes
└─ "Apply" button

Status tabs (sticky, horizontal scroll):
├─ All
├─ Pending Verification
├─ Confirmed
├─ Processing
├─ Shipped
├─ Delivered
└─ Cancelled

Order list item:
├─ Order ID: 14px monospace
├─ Customer name: 14px
├─ Amount: 14px red bold
├─ Status badge: colored
├─ Date: 12px gray
├─ Payment status: small badge
└─ Tap to open detail, full width
```

### Order Detail (Admin)
```
Layout (Mobile):
1. Header: "Order #ORD-12345"
2. Order status section (timeline)
3. Customer info (card)
4. Items section (list)
5. Payment section
6. Shipment section
7. Action buttons (sticky at bottom)

Order status:
├─ Current: Large, bold, colored badge
├─ Timeline: Vertical with checkmarks
└─ Date/time of each status

Customer info card:
├─ Name: 16px bold
├─ Phone: 14px, clickable
├─ Email: 14px, clickable
├─ Delivery address: 12px
└─ Background: #F9FAFB

Items section:
├─ Item row: image (60x60px) + name + quantity + price
├─ Dividers: 1px #E5E7EB
└─ Subtotal at bottom: 16px bold

Payment section:
├─ Method: "bKash Send Money" or "Cash on Delivery"
├─ Amount: 16px bold
├─ Status badge: colored
├─ If bKash verified:
│  ├─ Transaction ID: 12px monospace
│  ├─ Screenshot: clickable thumbnail
│  ├─ Verified on: date, time
│  └─ "Reject Payment" button (if not verified)
└─ If COD: "Confirm Order" button

Shipment section:
├─ Courier selection: dropdown (if not yet created)
├─ "Create Shipment" button
├─ If shipment created:
│  ├─ Courier: "Pathao"
│  ├─ Parcel ID: "PRN-1234567"
│  ├─ Status: "Created" (green badge)
│  └─ "Track" button

Action buttons (sticky bottom):
├─ "Verify Payment" (if bKash, unverified)
├─ "Reject Payment" (if bKash, unverified)
├─ "Create Shipment" (if not created)
├─ "Change Courier" (if created)
└─ "Cancel Order" (if allowed)
```

### Payment Verification (Admin)
```
Layout (Mobile):
1. Header: "Verify Payment"
2. Transaction info
3. Payment details
4. Customer info
5. Screenshot preview
6. Action buttons

Transaction info:
├─ Order ID: 14px
├─ Amount: 16px bold red
├─ Submitted on: 12px gray

Payment details:
├─ Transaction ID: 14px monospace
├─ bKash number: 14px monospace
├─ Status: Yellow badge "Pending Verification"

Customer info:
├─ Name: 14px
├─ Phone: 14px
├─ Email: 14px

Screenshot:
├─ "Click to expand" or "View full image"
├─ Full width display on tap
├─ Back button to close

Buttons (sticky bottom):
├─ "Verify & Confirm" button: green, full width, 48px
└─ "Reject Payment" button: red, full width, 44px
   ├─ On tap: shows reason dropdown
   ├─ Reason: "Incorrect amount", "Wrong account", etc.
   └─ "Reject" button to confirm
```

### Product Management
```
Layout (Mobile):
1. Header: "Products"
2. Search bar: 44px
3. Filter bar (collapsed)
4. Product list
5. "Add Product" button (floating)

Product list:
├─ Product image: 60x60px
├─ Name: 14px
├─ Price: 14px red
├─ Stock: 12px gray ("15 in stock")
├─ Status: small badge (Active/Inactive)
└─ Tap to edit, full width

Product row:
├─ Full width, 80px height
├─ Divider: 1px #E5E7EB
└─ Padding: 12px

Add Product button:
├─ Position: Fixed bottom-right
├─ Size: 56x56px
├─ Icon: + (white)
├─ Background: #DC143C
├─ Tap to open form

Edit product form (when tapped):
├─ Product name input
├─ Category select
├─ Price input
├─ Stock input
├─ Description textarea
├─ Images upload
├─ Variants section
├─ Active toggle
├─ Featured toggle
└─ "Save" button: full width, 48px red
```

### Shipment Creation (Modal)
```
Layout:
1. Header: "Create Shipment"
2. Courier selection
3. Order info (read-only)
4. Delivery address (read-only)
5. COD amount (if applicable)
6. "Create Shipment" button

Courier selection:
├─ Radio buttons, 48px height each
├─ Option 1: "Pathao"
├─ Option 2: "Steadfast"
├─ Option 3: "Other Courier"

Order info:
├─ Order ID: 14px
├─ Items count: 14px
├─ Amount: 14px red bold
└─ Read-only

Delivery address:
├─ Full address text: 12px
├─ Phone: 12px
└─ Read-only

COD amount (if applicable):
├─ Label: "COD Amount"
├─ Amount: 16px bold
├─ Pre-filled from order total

Button:
├─ "Create Shipment": Full width, 48px red
├─ Loading state: Shows spinner
├─ Success: Shows "Parcel ID: PRN-123"
└─ Error: Shows error message with "Retry" button
```

---

## ♿ ACCESSIBILITY REQUIREMENTS

### Color Contrast
```
Text on background: ≥ 4.5:1 contrast ratio
- #111827 on #FFFFFF: 12.6:1 ✓
- #DC143C on #FFFFFF: 4.5:1 ✓
- #6B7280 on #FFFFFF: 4.5:1 (borderline, avoid for important)

Large text (18px+): ≥ 3:1 ratio
All badges and status indicators must be readable
```

### Touch Targets
```
Minimum size:     44x44px (44px in iOS guidelines)
Recommended:      48x48px (better for mobile)
Minimum spacing:  8px between targets
Buttons:          44px height minimum (48px preferred)
Form fields:      44px height minimum
Checkboxes:       20x20px, with 8px padding (28x28px tap area)
Radio buttons:    Same as checkboxes
Links in text:    Minimum 44px tap area
```

### Keyboard Navigation
```
Tab order: Natural reading order (left to right, top to bottom)
Focus state: Always visible, 2px outline in primary color
Skip links: "Skip to main content" (hidden until focused)
Form validation: Clear error messages
Modals: Focus trap (tab loops within modal)
```

### Forms
```
Labels: Always visible, not as placeholders
Required indicators: * in red, "Required" text
Error messages: Clear, specific, in red, below field
Success messages: Green, with checkmark icon
Form instructions: 12px gray, above field if complex
```

### Images
```
Product images: Good quality, no text in image only
Alt text: Descriptive, 1-2 sentences
Decorative images: Empty alt text (alt="")
Icons: Labeled in text or aria-label
Screenshots: Describe key elements
```

### Motion & Animation
```
No infinite animations
Avoid: Flashing (> 3 times/second)
Reduce motion: Respect prefers-reduced-motion CSS
Animations: 200-300ms maximum
Purpose: Should enhance, not distract
```

---

## ⚡ PERFORMANCE TARGETS (Mobile Focus)

### Load Time Goals
```
First Contentful Paint (FCP):   < 1.5s on 4G
Largest Contentful Paint (LCP): < 2.5s on 4G
Total page load:                < 3s on 4G
Largest Contentful Paint (LCP): < 4s on 3G
```

### Bundle Size
```
JavaScript:  < 150KB (gzipped)
CSS:         < 50KB (gzipped)
Images:      Optimized, WebP format
Fonts:       System fonts or subset of Google Fonts
Total:       < 300KB (gzipped, initial)
```

### Optimization Rules
```
✓ Lazy load images below fold
✓ Use responsive images (srcset)
✓ Minimize CSS (no unused styles)
✓ Tree-shake JavaScript
✓ No render-blocking resources
✓ Cache static assets (service worker or CDN)
✓ Minify HTML, CSS, JS
✓ Use WebP images (JPEG fallback)
✓ Defer non-critical JavaScript
✓ Inline critical CSS
✓ No heavy animations
✓ No autoplay media
✓ No third-party tracking
```

---

## 🌍 BILINGUAL SUPPORT

### Language Configuration
```
Default language: English
Supported: English (en), Bangla (bn)
Storage: localStorage key "language"
Detection: User preference (localStorage) > Browser > Default (English)

UI must always be in English unless user changes language preference.
```

### Currency Display
```
Symbol: ৳ (Taka)
Position: Left (৳ 1,500)
Format: ৳ 1,500.00 (with thousand separator)
Decimal places: 2
No spaces between symbol and number
```

### Date Format
```
Display: DD MMM YYYY
Example: 17 Sep 2026
Never use ambiguous formats (MM/DD or DD/MM)
```

### Number Format
```
Thousand separator: , (comma)
Decimal separator: . (dot)
Examples:
├─ 1,500.00
├─ 10,000.50
└─ 500.00
```

### Form Localization
```
Email: Always English format (user@example.com)
Phone: +880 format (Bangladesh country code)
Address fields: Support Bengali address input
Payment info: English for bKash transaction IDs
Timestamps: Always show timezone or local time
```

---

## 📋 IMPLEMENTATION CHECKLIST

Before building any component or page:

### Layout & Spacing
- [ ] Mobile-first design (start at 375px)
- [ ] All text 14px+ on mobile
- [ ] All buttons 44x44px minimum (48x48px preferred)
- [ ] Form inputs 44px height minimum
- [ ] Page padding 16px on sides (3xl spacing)
- [ ] Card padding 16px (3xl spacing)
- [ ] Spacing between elements: Use 4px base unit

### Colors
- [ ] Use colors from design system only
- [ ] Primary action: #DC143C
- [ ] Text: #111827 on white background
- [ ] Borders: #E5E7EB
- [ ] No custom colors without design review

### Typography
- [ ] Font: Inter for English (from Google Fonts)
- [ ] H1: 28px mobile, 36px desktop, bold (700)
- [ ] H2: 20px mobile, 28px desktop, bold (700)
- [ ] Body: 14px mobile, 16px desktop, regular (400)
- [ ] Line height: 1.6 for body, 1.3 for headings
- [ ] No extra letter spacing

### Navigation
- [ ] Header: 56px height
- [ ] Bottom tab navigation (recommended)
- [ ] Hamburger menu for secondary nav
- [ ] Mobile header: Hamburger | Logo | Cart/Search
- [ ] No dropdown menus on mobile

### Forms
- [ ] Labels above inputs (not placeholder)
- [ ] All inputs 44px height minimum
- [ ] 100% width on mobile
- [ ] Focus state: 2px red border
- [ ] Error state: 2px deep red border + error text
- [ ] Required indicators: * in red
- [ ] Clear help text if needed

### Images
- [ ] Product images: Square (1:1) on mobile
- [ ] Full width images: No padding inside image
- [ ] Lazy loading implemented
- [ ] WebP format with JPEG fallback
- [ ] Proper alt text on all images
- [ ] No background images (mobile data)

### Mobile-Specific
- [ ] Touch targets: 44x44px minimum
- [ ] No hover states (mobile doesn't hover)
- [ ] No multi-column forms
- [ ] Sticky buttons (checkout, cart)
- [ ] Swipeable product galleries
- [ ] Full-width modals or bottom sheets

### Responsiveness
- [ ] Test at 320px (ensure fit)
- [ ] Test at 375px (standard mobile)
- [ ] Test at 425px (large mobile)
- [ ] Test at 768px (tablet)
- [ ] Test at 1024px (desktop)
- [ ] No horizontal scrolling on any size
- [ ] Content readable at all sizes

### Language & Localization
- [ ] UI text: English only
- [ ] Currency: ৳ symbol, proper format
- [ ] Date format: DD MMM YYYY
- [ ] Phone: +880 format support
- [ ] Address: Division/District support
- [ ] Tested in both English and Bangla

### Accessibility
- [ ] Color contrast: ≥ 4.5:1 for text
- [ ] Focus indicators: Visible (2px red outline)
- [ ] Keyboard navigation: Tab order logical
- [ ] Form labels: Always associated
- [ ] Error messages: Clear and specific
- [ ] Images: Alt text provided
- [ ] No rapid flashing (> 3 times/second)

### Performance
- [ ] Images optimized (< 100KB each)
- [ ] No render-blocking resources
- [ ] Minified CSS, JavaScript, HTML
- [ ] Lazy loading implemented
- [ ] No heavy animations
- [ ] No autoplay media
- [ ] Lighthouse score > 80

### Quality
- [ ] No AI-generated look (gradients, blur, etc.)
- [ ] Consistent with design system
- [ ] Professional appearance
- [ ] No unnecessary effects
- [ ] Fast load times
- [ ] Tested on real mobile devices

---

## 🔧 COMMON CODE SNIPPETS

### Primary Button (HTML)
```html
<button class="btn btn-primary">Add to Cart</button>

<!-- CSS -->
<style>
.btn-primary {
  height: 44px;
  padding: 0 16px;
  width: 100%;
  background-color: #DC143C;
  color: white;
  font-size: 14px;
  font-weight: 700;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  tap-highlight-color: transparent;
}

.btn-primary:active {
  background-color: #A00E2A;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
```

### Form Input (HTML)
```html
<label for="fullname">Full Name *</label>
<input 
  id="fullname"
  type="text"
  placeholder="Enter your full name"
  required
>

<!-- CSS -->
<style>
label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #111827;
  margin-bottom: 8px;
}

input {
  width: 100%;
  height: 44px;
  padding: 12px;
  font-size: 16px;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  box-sizing: border-box;
  -webkit-appearance: none;
  appearance: none;
}

input:focus {
  outline: none;
  border-color: #DC143C;
  border-width: 2px;
  padding: 11px; /* Adjust for border width */
}

input:invalid {
  border-color: #DC2626;
}
</style>
```

### Product Card (HTML)
```html
<div class="product-card">
  <img src="product.jpg" alt="Product name" class="product-image">
  <h3>Product Name</h3>
  <p class="rating">⭐ 4.5 (120)</p>
  <p class="price">৳ 1,500</p>
  <button class="btn btn-primary">Add to Cart</button>
  <button class="btn btn-secondary">Add to Wishlist</button>
</div>

<!-- CSS -->
<style>
.product-card {
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  background: white;
  padding: 12px;
  overflow: hidden;
}

.product-image {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 4px;
  margin-bottom: 8px;
}

.product-card h3 {
  font-size: 14px;
  font-weight: 700;
  color: #111827;
  margin: 8px 0;
}

.product-card .rating {
  font-size: 12px;
  color: #6B7280;
  margin: 4px 0;
}

.product-card .price {
  font-size: 16px;
  font-weight: 700;
  color: #DC143C;
  margin: 8px 0;
}
</style>
```

---

## 📖 RELATED DOCUMENTS

- `language-config.json` - Language, translation, color, and spacing configuration
- `ecommerce-design.md` - Base design system
- `DESIGN_SPEC_MOBILE_FIRST.md` - Detailed mobile specifications
- `MOBILE_FIRST_COMPONENTS.md` - Individual component guide
- `DESIGN_FLOWS.md` - User journey diagrams
- `DESIGN_COMPONENTS.md` - Complete component checklist
- `DESIGN_RESOURCES.md` - Tools, references, and guidelines

---

## 🎯 WHEN IN DOUBT

1. **Check this document first** for design decisions
2. **Use language-config.json** for colors, fonts, translations
3. **Reference design system** for consistency
4. **Test on mobile** (375px base)
5. **Ask for design review** if uncertain
6. **No AI-generated aesthetics** - Stay professional and clean
7. **Accessibility first** - Follow WCAG guidelines
8. **Performance matters** - Optimize aggressively

---

**Version 1.0** | Last Updated: 2026-09-17
