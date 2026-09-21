# Screen Inventory (Design Scope)

The list of screens to design/build, split by surface. Moved here from `.claude/settings.json`,
where these keys were not part of the Claude Code settings schema and were ignored at runtime.

Authoritative behaviour lives in `.claude/project requirment documents/`;
visual specs live in `.claude/skills/design/SKILL.md`. This file is scope only.


## Customer Storefront

- Homepage with featured products
- Product listing and filtering
- Product detail page
- Shopping cart
- Checkout - Payment method selection
- Checkout - bKash payment info
- Checkout - COD confirmation
- Order confirmation
- Customer dashboard
- Order history and tracking
- User profile and addresses
- Wishlist

## Admin Panel

- Admin dashboard/home
- Order management panel
- bKash order verification
- COD order confirmation
- Payment verification interface
- Courier selection and shipment creation
- Shipment tracking
- Product catalogue management
- Category management
- Customer management
- Analytics and reports dashboard
- Staff and role management

## Payment Flows

- bKash payment flow with transaction ID submission
- COD order confirmation flow
- Payment verification and rejection
- Payment resubmission flow

## Courier Integrations

- Pathao shipment creation
- Steadfast shipment creation
- Shipment tracking
- Shipment failure handling
