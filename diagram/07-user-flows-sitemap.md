# 07 - User Flows and Sitemap

Source: `frontend/src/app` (real routes), `02-customer.md`, `13-homepage-cms.md`.

## 1. Storefront sitemap

```mermaid
flowchart TD
    H["/ Home<br/>CMS sections and campaigns"] --> PL["/products"]
    H --> CAT["/category/slug"]
    H --> PD["/product/slug"]
    PL --> PD
    CAT --> PD
    PD --> CA["/cart"]
    CA --> CH["/checkout"]
    CH --> DONE["Order confirmation"]

    H --> TR["/track-order"]
    H --> LK["/orders/lookup"]
    H --> AUTH["/auth/login, /auth/register"]
    AUTH --> ACC["/account"]
    ACC --> AP["/account/profile"]
    ACC --> AA["/account/addresses"]
    ACC --> AO["/account/orders"]
    AO --> AOD["/account/orders/orderNumber"]
    ACC --> ACP["/account/change-password"]
```

Also present: `sitemap.xml`, `robots.txt`, WhatsApp click-to-chat button, Meta Pixel PageView.

## 2. Customer purchase journey

```mermaid
flowchart TD
    A([Visitor]) --> B["Browse home, category or product list"]
    B --> C["Open product, choose size and colour variant"]
    C --> D{"In stock?"}
    D -->|no| C
    D -->|yes| E["Add to cart"]
    E --> F["Go to checkout"]
    F --> G{"Logged in?"}
    G -->|yes| H["Use saved address<br/>(profile must be complete)"]
    G -->|no| I["Continue as guest:<br/>name, phone, address"]
    H --> J["Apply coupon, see shipping and total"]
    I --> J
    J --> K{"Payment method"}
    K -->|bKash| L["Send money manually,<br/>enter transaction id"]
    K -->|COD| M["Pay on delivery"]
    L --> N["Place order"]
    M --> N
    N --> O["Order number shown"]
    O --> P{"After placing"}
    P -->|bKash| Q["Wait for payment verification"]
    P -->|COD| R["Wait for confirmation call"]
    P --> S["Track order or look up with phone"]
```

## 3. Guest versus registered

| Capability | Guest | Registered |
| --- | :-: | :-: |
| Browse and buy | Yes | Yes |
| Saved address and profile | No | Yes |
| Order history page | No | Yes |
| Look up order by order number and phone | Yes | Yes |
| Track by courier tracking id | Yes | Yes |
| Coupons marked "registered only" | No | Yes |

A guest is stored as a `customers` row with `account_type = GUEST`. Registering later reuses the same phone-number record.

## 4. Admin back-office sitemap

```mermaid
flowchart TD
    L["/admin/login"] --> CP{"must change password?"}
    CP -->|yes| CHG["/admin/change-password"]
    CP -->|no| D["/admin Dashboard"]
    CHG --> D
    D --> OR["Orders<br/>list, detail, payment, shipment, cancel"]
    D --> CU["Customers<br/>list, detail, risk check"]
    D --> CATG["Catalogue<br/>products, new, edit, categories"]
    D --> MK["Marketing<br/>coupons"]
    D --> CT["Content<br/>homepage sections, campaigns, preview"]
    D --> RP["Reports<br/>sales, orders, payments, shipments,<br/>products, customers, coupons"]
    D --> ST["Settings<br/>couriers, shipping zones and rates"]
    D --> MG["Managers (Admin only)"]
    D --> AL["Audit logs"]
```

Menu items are shown or hidden by permission, but the backend re-checks every call.

## 5. Admin daily order routine

```mermaid
flowchart LR
    A["New order arrives"] --> B{"Payment method"}
    B -->|bKash| C["Verify or reject transaction"]
    B -->|COD| D["Call customer, optional risk check"]
    C --> E["Confirm order<br/>(stock decremented)"]
    D --> E
    E --> F["Create shipment with Pathao or Steadfast"]
    F --> G["Order becomes PROCESSING"]
    G --> H["Mark parcel shipped (hand-over)"]
    H --> I["Courier updates sync automatically"]
    I --> J["DELIVERED or RETURNED"]
    J --> K["COD: confirm cash collected"]
```
