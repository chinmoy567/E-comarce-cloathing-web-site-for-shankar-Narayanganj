# 08 - Use Cases (Who Can Do What)

Source: requirement docs 02 to 13 and `backend/src/routes`. Permission keys are in `06-rbac.md`.

## 1. Actors

```mermaid
flowchart LR
    G["Guest customer"]
    R["Registered customer"]
    M["Manager"]
    A["Admin"]
    SYS["System<br/>schedulers, webhooks"]
    CO["Courier<br/>Pathao, Steadfast"]
    ME["Meta"]
    RK["BD Courier risk API"]

    G -.->|can become| R
    M -.->|subset of| A
```

## 2. Storefront use cases

```mermaid
flowchart LR
    G["Guest"]
    R["Registered customer"]

    subgraph Shop["Fabrillke storefront"]
        U1(["Browse products and categories"])
        U2(["View product and variants"])
        U3(["Manage cart"])
        U4(["Preview coupon and shipping"])
        U5(["Place order - bKash or COD"])
        U6(["Submit bKash transaction id at checkout"])
        U7(["Look up order by number and phone"])
        U8(["Track parcel by courier id"])
        U9(["Register and log in"])
        U10(["Edit profile and addresses"])
        U11(["View order history"])
        U12(["Contact via WhatsApp"])
    end

    G --> U1 & U2 & U3 & U4 & U5 & U7 & U8 & U9 & U12
    R --> U1 & U2 & U3 & U4 & U5 & U6 & U8 & U10 & U11 & U12
```

## 3. Back-office use cases

```mermaid
flowchart LR
    A["Admin"]
    M["Manager"]

    subgraph Ops["Operations (Manager has by default)"]
        O1(["View dashboard"])
        O2(["Create and edit products, variants, prices, stock"])
        O3(["Manage categories and images"])
        O4(["View orders"])
        O5(["Verify or reject bKash payment"])
        O6(["Confirm order - bKash and COD"])
        O7(["Create shipment, retry, change courier, mark shipped"])
        O8(["View customers and run risk check"])
        O9(["View coupons and usage"])
    end

    subgraph Assigned["Operations (Manager only if Admin assigns)"]
        S1(["Cancel or update orders"])
        S2(["Delete products"])
        S3(["Create, edit, activate, archive coupons"])
        S4(["Manage homepage and campaigns CMS"])
        S5(["Configure couriers"])
        S6(["View analytics and audit logs"])
        S7(["Update customers"])
    end

    subgraph Adm["Administrative (Admin only)"]
        D1(["Create, edit, delete managers"])
        D2(["Assign permissions"])
        D3(["System and RBAC configuration"])
        D4(["Shipping zones and rates"])
    end

    A --> Ops & Assigned & Adm
    M --> Ops
    M -.->|if granted| Assigned
```

Shipping zone and rate management requires `system.configure`, so it is Admin only (`routes/admin/shipping.routes.ts`).

## 4. System and external use cases

```mermaid
flowchart LR
    SYS["System"]
    CO["Courier"]
    ME["Meta CAPI"]
    RK["BD Courier risk API"]

    subgraph Auto["Automatic behaviour"]
        Y1(["Poll courier status for active shipments"])
        Y2(["Receive courier webhooks"])
        Y3(["Cascade shipment DELIVERED or RETURNED to order"])
        Y4(["Restore stock on cancel or return"])
        Y5(["Send Purchase event after order CONFIRMED"])
        Y6(["Refresh daily report rollups"])
        Y7(["Build report exports into Supabase Storage"])
        Y8(["Write audit log and status history"])
    end

    CO -->|webhook| Y2
    SYS --> Y1 & Y6 & Y7
    Y1 --> Y3
    Y2 --> Y3
    Y3 --> Y4
    Y5 --> ME
    SYS --> Y8
    RK -.->|used on admin request| Y8
```

## 5. Use case index

| # | Use case | Actor | Main spec |
| --- | --- | --- | --- |
| 1 | Browse and search catalogue | Guest, Customer | 02, 13 |
| 2 | Place bKash or COD order | Guest, Customer | 03 |
| 3 | Apply coupon | Guest, Customer | 10 |
| 4 | Track or look up an order | Guest, Customer | 02, 04 |
| 5 | Verify or reject bKash payment | Admin, Manager | 03, 07 |
| 6 | Confirm order | Admin, Manager | 07 |
| 7 | Create shipment and manage courier | Admin, Manager | 04 |
| 8 | Fraud / risk check | Admin, Manager | 09 |
| 9 | Manage catalogue | Admin, Manager | 05 |
| 10 | Manage coupons | Admin, Manager (assigned) | 10 |
| 11 | Manage homepage CMS | Admin, Manager (assigned) | 13 |
| 12 | Manage managers and permissions | Admin | 06 |
| 13 | Reports and exports | Admin, Manager (assigned) | 05 |
| 14 | Meta Pixel and CAPI tracking | System | 08 |
