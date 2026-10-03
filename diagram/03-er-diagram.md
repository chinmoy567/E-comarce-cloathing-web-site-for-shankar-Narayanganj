# 03 - Database ER Diagram

Source: `backend/migrations/0001` to `0019` (PostgreSQL / Supabase). Only key columns are shown.
Money columns are `numeric(12,2)`. Enum values are listed in section 6.

## 1. Identity, RBAC and audit

```mermaid
erDiagram
    customers ||--o| users : "customer_id (CUSTOMER role only)"
    users ||--o{ users : "created_by"
    users ||--o{ user_permissions : "has"
    permissions ||--o{ user_permissions : "granted as"
    users ||--o{ refresh_tokens : "sessions"
    users ||--o{ audit_logs : "actor_user_id"

    customers {
        uuid id PK
        account_type account_type "GUEST or REGISTERED"
        text full_name
        text phone_number UK "01[3-9]xxxxxxxx"
        text email
        text division
        text district
        text area_unit_name
        text ward_unit_name
        text detailed_address
    }
    users {
        uuid id PK
        user_role role "ADMIN, MANAGER, CUSTOMER"
        text user_identifier UK "admin and manager login"
        text phone_number UK "customer login"
        text password_hash
        uuid customer_id FK
        bool is_system_admin "only one allowed"
        bool is_active
        bool must_change_password
    }
    permissions {
        text key PK "e.g. order.confirm"
        text label
        permission_tier admin_tier
        permission_tier manager_tier "YES, ASSIGNED, NO"
        bool is_administrative
    }
    user_permissions {
        uuid id PK
        uuid user_id FK
        text permission_key FK
        uuid granted_by FK
    }
    refresh_tokens {
        uuid id PK
        uuid user_id FK
        uuid replaced_by FK "rotation chain"
    }
    audit_logs {
        uuid id PK
        text entity_type
        uuid entity_id
        text action
        jsonb previous_value
        jsonb new_value
        uuid actor_user_id FK
        text actor_type "USER or SYSTEM"
    }
```

## 2. Catalogue

```mermaid
erDiagram
    categories ||--o{ categories : "parent"
    categories ||--o{ products : "contains"
    products ||--o{ product_variants : "has"
    products ||--o{ product_images : "has"
    product_attributes ||--o{ product_attribute_values : "has"
    product_variants ||--o{ product_variant_values : "defined by"
    product_attribute_values ||--o{ product_variant_values : "used in"

    categories {
        uuid id PK
        text name
        text slug UK
        uuid parent_id FK "one level of nesting"
        product_status status
    }
    products {
        uuid id PK
        uuid category_id FK
        text name
        text slug UK
        text sku
        product_status status "ACTIVE or INACTIVE"
    }
    product_variants {
        uuid id PK
        uuid product_id FK
        text sku
        numeric price
        int stock_quantity
    }
    product_attributes {
        uuid id PK
        text name
        attribute_type type "SIZE, COLOUR, AGE_GROUP, OTHER"
    }
    product_attribute_values {
        uuid id PK
        uuid attribute_id FK
        text value
    }
    product_variant_values {
        uuid variant_id FK
        uuid attribute_value_id FK
    }
    product_images {
        uuid id PK
        uuid product_id FK
        text storage_path "Supabase Storage"
    }
```

## 3. Orders, payment, shipment and coupons

```mermaid
erDiagram
    customers ||--o{ orders : "places"
    orders ||--|{ order_items : "contains"
    products ||--o{ order_items : "snapshot of"
    product_variants ||--o{ order_items : "snapshot of"
    orders ||--o| shipments : "1 to 1"
    orders ||--o{ order_status_history : "audit trail"
    couriers ||--o{ shipments : "courier code"
    shipments ||--o{ courier_requests : "API call log"
    shipments ||--o{ shipment_sync_events : "tracking sync"
    coupons ||--o{ orders : "applied to"
    coupons ||--o{ coupon_usages : "redeemed"
    orders ||--o| coupon_usages : "one per order"
    customers ||--o{ coupon_usages : "used by"
    coupons ||--o{ coupon_products : "limited to"
    coupons ||--o{ coupon_categories : "limited to"
    products ||--o{ coupon_products : "eligible"
    categories ||--o{ coupon_categories : "eligible"
    customers ||--o{ customer_risk_checks : "risk result cached"
    orders ||--o| customer_risk_checks : "one check per order"
    orders ||--o{ meta_event_log : "Meta CAPI events"
    users ||--o{ order_status_history : "actor"

    orders {
        uuid id PK
        text order_number UK
        uuid customer_id FK
        payment_method payment_method "BKASH or COD"
        order_status order_status
        payment_status payment_status
        numeric subtotal
        numeric discount_amount
        numeric shipping_amount
        numeric total_amount "= subtotal - discount + shipping"
        text shipping_zone_code
        uuid coupon_id FK
        text coupon_code "snapshot"
        text bkash_transaction_id UK
        text idempotency_key UK "prevents duplicate orders"
        text full_name "address snapshot"
        text district "address snapshot"
        text cancellation_reason
        uuid cancelled_by FK
    }
    order_items {
        uuid id PK
        uuid order_id FK
        uuid product_id FK
        uuid product_variant_id FK
        text product_name "snapshot"
        numeric unit_price "snapshot"
        int quantity
        numeric line_total
    }
    shipments {
        uuid id PK
        uuid order_id FK,UK
        shipment_status shipment_status
        text courier FK
        text courier_order_id
        text tracking_url
        numeric cod_amount
        text courier_error
        text return_reason
    }
    couriers {
        text code PK "PATHAO, STEADFAST"
        text adapter_key
        bool is_enabled
        bool supports_cancel
        jsonb config
    }
    courier_requests {
        uuid id PK
        uuid shipment_id FK
        text operation "CREATE, DETAILS, TRACK, CANCEL"
        bool succeeded
        int http_status
    }
    shipment_sync_events {
        uuid id PK
        uuid shipment_id FK
    }
    order_status_history {
        uuid id PK
        uuid order_id FK
        text status_field "order, payment or shipment"
        text previous_status
        text new_status
        uuid actor_user_id FK
    }
    coupons {
        uuid id PK
        text code UK "case-insensitive"
        discount_type discount_type
        numeric discount_value
        numeric minimum_order_amount
        timestamptz starts_at
        timestamptz expires_at
        int usage_limit
        int usage_count
        int per_customer_limit
        customer_eligibility customer_eligibility
        product_eligibility product_eligibility
        coupon_status status
    }
    coupon_usages {
        uuid id PK
        uuid coupon_id FK
        uuid order_id FK,UK
        uuid customer_id FK
        numeric discount_amount
    }
    customer_risk_checks {
        uuid id PK
        uuid customer_id FK
        uuid order_id FK,UK
        text provider "BD Courier"
        int risk_score
        text risk_level
        int total_orders
        int returned_orders
        uuid checked_by FK
    }
    meta_event_log {
        uuid id PK
        uuid order_id FK
        text event_id "dedupe key"
        text event_name
    }
```

## 4. Shipping zones and geography

```mermaid
erDiagram
    shipping_zones ||--o{ shipping_zone_districts : "covers"
    shipping_zones ||--o{ shipping_rates : "priced by"
    users ||--o{ shipping_rates : "created_by"
    geo_divisions ||--o{ geo_districts : "has"
    geo_districts ||--o{ geo_upazilas : "has"
    courier_location_mappings }o--|| couriers : "Pathao and Steadfast city and zone ids"

    shipping_zones {
        uuid id PK
        text code UK "INSIDE_DHAKA, DHAKA_SUBURB, OUTSIDE_DHAKA"
        bool is_default "exactly one"
    }
    shipping_zone_districts {
        uuid zone_id FK
        text district
        bool metro_only
    }
    shipping_rates {
        uuid id PK
        uuid zone_id FK
        text strategy "FLAT, FREE, FREE_OVER_THRESHOLD"
        numeric flat_amount
        numeric free_over_amount
        timestamptz effective_from "history kept"
    }
    shipping_unmatched_districts {
        text district_key PK
        int occurrences
    }
    geo_divisions {
        uuid id PK
        text name
    }
    geo_districts {
        uuid id PK
        text name
    }
    geo_upazilas {
        uuid id PK
        text name
    }
    courier_location_mappings {
        geo_level level "DIVISION, DISTRICT, UPAZILA"
        text courier_code
    }
```

## 5. Homepage CMS and reporting

```mermaid
erDiagram
    campaigns ||--o{ homepage_sections : "optional link"
    campaigns ||--o{ campaign_products : "features"
    campaigns ||--o{ campaign_categories : "features"
    homepage_sections ||--o{ homepage_section_products : "shows"
    homepage_sections ||--o{ homepage_section_categories : "shows"
    products ||--o{ campaign_products : ""
    products ||--o{ homepage_section_products : ""
    categories ||--o{ campaign_categories : ""
    categories ||--o{ homepage_section_categories : ""
    users ||--o{ report_exports : "requested_by"

    campaigns {
        uuid id PK
        cms_status status "DRAFT, ACTIVE, DISABLED"
    }
    homepage_sections {
        uuid id PK
        section_type type
        cms_status status
        uuid campaign_id FK
    }
    report_daily_sales {
        date day "Dhaka day rollup"
    }
    report_exports {
        uuid id PK
        uuid requested_by FK
    }
```

## 6. Enums

| Enum | Values |
| --- | --- |
| `user_role` | ADMIN, MANAGER, CUSTOMER |
| `account_type` | GUEST, REGISTERED |
| `order_status` | PENDING_CONFIRMATION, COD_VERIFICATION_PENDING, CONFIRMED, PROCESSING, DELIVERED, CANCELLED, RETURNED |
| `payment_method` | BKASH, COD |
| `payment_status` | PENDING_VERIFICATION, PAID_VERIFIED, REJECTED, PENDING_COLLECTION, PAID_COLLECTED |
| `shipment_status` | NOT_CREATED, CREATING, CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, CREATION_FAILED, DELIVERY_FAILED, RETURNED |
| `discount_type` | PERCENTAGE, FIXED_AMOUNT |
| `coupon_status` | DRAFT, ACTIVE, DISABLED |
| `risk_level` | LOW, MEDIUM, HIGH, UNKNOWN, CHECK_FAILED |
| `section_type` | HERO, CATEGORY_GRID, PRODUCT_CAROUSEL, CAMPAIGN_BANNER, PROMO_BANNER, CUSTOM_CONTENT |

## 7. Integrity rules worth knowing

- `orders.idempotency_key` unique: a double-clicked checkout cannot create two orders.
- `orders.bkash_transaction_id` unique: one bKash transaction cannot pay two orders.
- `shipments.order_id` unique: one shipment per order (no duplicate shipments).
- `coupon_usages.order_id` unique: one coupon redemption per order.
- `orders_total_composition_check`: `total = subtotal - discount + shipping`.
- `order_items` stores name and price snapshots, so later catalogue edits never change past orders.
- Only one `is_system_admin` user can exist (partial unique index).
