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

## 0. Website Identity

| Field | Value |
| --- | --- |
| Website / Brand Name | **Fabrillke** |
| Domain Name | **fabrillke.com** |
| Primary Website URL | **https://fabrillke.com** |

Use **Fabrillke** as the brand name and **fabrillke.com** as the canonical domain
everywhere: branding, page titles, SEO/Open Graph/Twitter metadata, canonical URLs,
sitemap, robots, JSON-LD, email templates, the footer, and configuration.

Never use a placeholder such as "Fashion Store", "Clothing Store", "E-commerce Platform",
or any other brand name in customer-facing output.

Read the identity from the shared config rather than re-typing it:
`frontend/src/lib/site.ts` on the frontend, `backend/src/config/constants.ts` plus
`PUBLIC_SITE_URL` on the backend. Full definition: `01-overview.md` §1.0.

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

## 10. Test Organization (Spec-Wise)

**All test files must be organized by spec in `backend/tests/`.**

### Directory Structure

```
backend/tests/
├── spec-01-auth/          # Customer auth & identity tests
├── spec-02-admin-rbac/    # Admin operations & RBAC tests
├── spec-03-audit/         # Audit logging tests
├── spec-04-security/      # Security hardening tests
├── spec-05-catalogue/     # Catalogue & admin management tests
├── spec-06-**/            # [Future specs, follow same pattern]
└── shared/                # Foundation tests (utilities, migrations, enums, etc.)
```

### When Adding a New Test File

1. **Identify which spec it belongs to** — Check `.claude/project requirement documents/` or the feature being tested.
2. **Save in the correct folder**:
   - If testing a new spec → Create `spec-XX-name/` and save there
   - If testing spec 01-05 → Save in the corresponding existing folder
   - If testing shared infrastructure (migrations, enums, transactions) → Save in `shared/`
3. **Update the vitest config** (`backend/vitest.specXX.config.ts`):
   - Add the new test file path to the `include` array
4. **Document in TEST_ORGANIZATION.md** if creating a new spec folder

### Example: Adding a test for Spec 06

```
backend/tests/spec-06-shipment/order-shipment.api.test.ts
```

Then update `backend/vitest.spec06.config.ts`:
```typescript
include: [
  'tests/spec-06-shipment/order-shipment.api.test.ts',
  // ... other tests
]
```

### Why This Matters

- Clear relationship between tests and features
- Can run spec-specific tests with `npm run test:specXX`
- Easier to maintain and understand test coverage
- Aligns with `.claude/project requirement documents/` structure

---

## 10. Final Priority

Always prioritize:

**Correctness → Security → Requirement Compliance → Data Integrity → Maintainability → Performance → Developer Convenience**

The requirement files contain the detailed behavior.

`CLAUDE.md` contains the rules Claude must follow while implementing them.
