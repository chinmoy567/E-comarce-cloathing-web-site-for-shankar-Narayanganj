# CLAUDE.md

## Project Rules

This is a Bangladesh-focused e-commerce platform.

Before implementing or modifying anything, **read the relevant files inside `.claude/project requirment documents/` first**.

```text
.claude/project requirment documents/
├── 01-overview.md
├── 02-customer.md
├── 03-payment-order.md
├── 04-courier-shipment.md
├── 05-admin-operations.md
├── 06-rbac.md
├── 07-order-state-machine.md
├── 08-analytics-meta.md
├── 09-fraud-risk-check.md
├── 10-coupon-discount.md
├── 11-security-hardening.md
├── 12-whatsapp-contact.md
└── 13-homepage-cms.md
```

---

## 1. Source of Truth

Priority:

1. Current user instruction
2. Requirement files
3. Existing project architecture
4. Existing implementation
5. General best practices

Do not invent requirements.

If requirements conflict, identify the conflict before making a major change.

`07-order-state-machine.md` is authoritative for order, payment, and shipment state transitions.

---

## 2. Fixed Tech Stack

### Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS

### Backend

- Node.js
- Express.js
- TypeScript
- REST API

### Database

- PostgreSQL
- Supabase

### Storage

- Supabase Storage

Do not introduce another database, backend framework, or major technology unless explicitly required.

---

## 3. Architecture

```text
Next.js
   ↓
Express.js REST API
   ↓
PostgreSQL / Supabase
   ↓
Supabase Storage
```

The **Express backend is the business-logic authority**.

The frontend must never be trusted for:

- Authentication
- Authorization
- Prices
- Discounts
- Inventory
- Payment verification
- Order state
- Permissions
- Security-sensitive operations

Privileged Supabase credentials must remain server-side.

---

## 4. Security

Always:

- Hash passwords securely.
- Never store plaintext passwords.
- Keep secrets in environment variables.
- Enforce RBAC on the backend.
- Validate all input server-side.
- Use parameterized database queries.
- Rate-limit sensitive endpoints.
- Protect file uploads.
- Do not expose secrets or sensitive data in logs.
- Do not hard-code credentials.
- Do not trust client-provided prices or totals.

---

## 5. Business-Critical Rules

Follow the documented requirements for:

- Customer authentication/profile
- bKash manual payment
- COD
- Order state machine
- Inventory
- Courier integration
- RBAC
- Coupons
- Fraud/risk checks
- Meta Pixel/CAPI
- WhatsApp
- Homepage/Campaign CMS
- SEO

Do not create alternative implementations when the requirements already define the behavior.

---

## 6. External APIs

Never guess an external API.

Use the current official documentation for:

- Pathao
- Steadfast
- Meta
- Risk/fraud providers
- Other external services

Keep external integrations isolated in backend service modules.

Handle API failures safely without corrupting internal order state.

---

## 7. Database

Use migrations for schema changes.

Maintain:

- Foreign keys
- Unique constraints
- Appropriate indexes
- Transactions
- Atomic operations

Prevent duplicate orders, double inventory deductions, duplicate shipments, and duplicate payment/event processing.

---

## 8. Frontend

The website must be:

- Mobile-first
- Responsive
- English
- Professional
- E-commerce focused

Avoid unnecessary AI-style visual design, excessive gradients, decorative effects, and unnecessary animations.

Prioritize usability, accessibility, performance, and product discovery.

---

## 9. Development Rules

Before changing code:

1. Read the relevant requirements.
2. Inspect the existing implementation.
3. Understand dependencies.
4. Make the smallest appropriate change.
5. Test the affected functionality.
6. Verify that existing features were not broken.

Do not rewrite working systems unnecessarily.

Do not add speculative features.

Do not introduce unnecessary technologies.

---

## 10. Final Priority

Always prioritize:

**Correctness → Security → Requirement Compliance → Data Integrity → Maintainability → Performance → Developer Convenience**

The requirement files contain the detailed behavior.

`CLAUDE.md` contains the rules Claude must follow while implementing them.
