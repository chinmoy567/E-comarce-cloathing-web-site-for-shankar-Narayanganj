# 02 - System Architecture

Source: `CLAUDE.md` section 3, `backend/src/routes/index.ts`, `backend/src/services/*`.
The Express backend is the business-logic authority. The browser is never trusted for prices, stock, auth or order state.

## 1. High-level components

```mermaid
flowchart TB
    subgraph Client["Browser"]
        SF["Storefront<br/>customer and guest"]
        AD["Admin / Manager back-office"]
    end

    subgraph FE["Frontend: Next.js, React, TypeScript, Tailwind"]
        PAGES["App Router pages<br/>SEO: metadata, sitemap, robots, JSON-LD"]
        PIXEL["Meta Pixel (browser)"]
    end

    subgraph BE["Backend: Express.js REST API, TypeScript"]
        MW["Middleware<br/>rate limit, auth, RBAC, validation"]
        RT["Routes<br/>admin, customer, public, webhooks"]
        CT["Controllers"]
        SV["Services - business rules<br/>checkout, orderStatus, shipment,<br/>coupon, shipping, inventory, reports"]
        RP["Repositories<br/>parameterized SQL"]
        AX["External adapters<br/>courier, fraud, Meta CAPI"]
        JOBS["Scheduled scripts<br/>pollCourierStatus, refreshReportRollups,<br/>processReportExports"]
    end

    subgraph DATA["Supabase"]
        PG[("PostgreSQL")]
        ST[("Storage<br/>homepage images, report exports")]
    end

    subgraph EXT["External services"]
        PATHAO["Pathao"]
        STEAD["Steadfast"]
        BDC["BD Courier<br/>fraud / risk API"]
        META["Meta Conversions API"]
        WA["WhatsApp click-to-chat<br/>wa.me link"]
    end

    SF --> PAGES
    AD --> PAGES
    PAGES -->|REST JSON| MW
    PIXEL -.->|browser events| META
    MW --> RT --> CT --> SV --> RP --> PG
    SV --> ST
    SV --> AX
    AX --> PATHAO
    AX --> STEAD
    AX --> BDC
    AX --> META
    PATHAO -.->|webhook| RT
    STEAD -.->|webhook| RT
    JOBS --> SV
    SF -.-> WA
```

## 2. Backend layering rule

```mermaid
flowchart LR
    R["routes<br/>mount validation only"] --> C["controllers<br/>HTTP in and out"] --> S["services<br/>ALL business logic"] --> Q["repositories<br/>SQL only"] --> D[("PostgreSQL")]
    S --> X["adapters<br/>one module per external API"]
```

## 3. Route groups (`backend/src/routes`)

| Mount | Audience | Purpose |
| --- | --- | --- |
| `/api/admin/*` | Admin, Manager | Auth, catalogue, orders, shipments, coupons, CMS, customers, managers, permissions, reports, couriers, shipping, audit logs |
| `/api/customer/auth`, `/api/customer/orders` | Registered customer | Register, login, profile, own orders, place order |
| `/api/products`, `/api/categories`, `/api/homepage` | Public | Browsing and homepage CMS |
| `/api/coupons`, `/api/shipping`, `/api/checkout` | Public (rate limited) | Coupon preview, shipping quote, price preview |
| `/api/orders/lookup`, `/api/track-order` | Public | Guest order lookup, courier tracking |
| `/api/analytics` | Public | Meta events |
| `/api/webhooks/courier/:code` | Courier (signature verified) | Inbound status updates |
| `/api/geography`, `/api/health` | Public | Division/district/upazila data, health |

## 4. Pages (`frontend/src/app`)

```mermaid
flowchart LR
    subgraph Store["Storefront"]
        H["/"]
        PL["/products"]
        PD["/product/slug"]
        CAT["/category/slug"]
        CA["/cart"]
        CH["/checkout"]
        TR["/track-order"]
        LK["/orders/lookup"]
        AU["/auth/login, /auth/register"]
        ACC["/account: profile, addresses, orders"]
    end
    subgraph Admin["/admin"]
        DB["Dashboard"]
        OR["Orders"]
        CU["Customers"]
        CATL["Catalogue: products, categories"]
        MK["Marketing: coupons"]
        CMS["Content: homepage, campaigns"]
        RE["Reports"]
        SET["Settings: couriers, shipping"]
        MG["Managers, Audit logs"]
    end
```

## 5. Security boundaries

- Secrets and the Supabase service-role key stay server-side only.
- RBAC is enforced in Express middleware (never RLS, never the frontend).
- Every external call lives in a service adapter; a provider failure never corrupts internal order state.
- Sensitive endpoints are rate limited; uploads are validated; passwords are hashed.
