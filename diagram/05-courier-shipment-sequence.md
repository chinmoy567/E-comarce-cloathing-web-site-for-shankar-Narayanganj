# 05 - Courier and Shipment Sequences

Source: `backend/src/services/shipment.service.ts`, `shipmentSync.service.ts`, `courierSync.service.ts`,
`courier/*`, `controllers/courierWebhook.controller.ts`, `04-courier-shipment.md`.

Design rules:
- One creation path serves create, retry and change-courier, so their guards cannot diverge.
- The committed `CREATING` status is the concurrency lock (no duplicate shipments).
- The courier is called **outside** the DB transaction, so a slow provider never holds a row lock.
- No automatic retry: a timeout might mean the parcel was created.
- A courier failure changes the shipment only. It never rejects payment or cancels the order.

## 1. Courier adapter structure

```mermaid
flowchart LR
    SS["shipment.service<br/>courierSync.service"] --> CS["courierService"]
    CS --> REG["registry<br/>adapter_key lookup"]
    REG --> P["pathao.adapter<br/>built, sandbox verified"]
    REG --> S["steadfast adapter<br/>not built yet"]
    P --> PA["Pathao API"]
    S --> SA["Steadfast API"]
    CS --> LOC["courierLocation.service<br/>district, upazila to courier city and zone ids"]
    CS --> LOG[("courier_requests<br/>call log, no secrets")]
```

## 2. Create shipment (also retry and change courier)

```mermaid
sequenceDiagram
    actor A as Admin or Manager
    participant API as Express API
    participant SH as shipment.service
    participant DB as PostgreSQL
    participant CR as Courier adapter
    participant EXT as Pathao or Steadfast

    A->>API: Create shipment (shipment.create + courier.select)
    API->>SH: createShipment(order, courier)
    Note over SH,DB: Phase 1 - transaction
    SH->>DB: Lock order, check guards
    alt shipment already CREATING
        SH-->>API: Conflict (concurrent creation blocked)
    else allowed
        SH->>DB: shipment_status = CREATING (committed lock)
    end
    Note over SH,EXT: Phase 2 - outside the transaction
    SH->>CR: createShipment(request)
    CR->>EXT: POST create parcel
    CR->>DB: log courier_requests
    alt success
        EXT-->>CR: courier order id, tracking
        Note over SH,DB: Phase 3 - transaction
        SH->>DB: CREATING to CREATED, store courier ids, tracking url
        SH->>DB: if order CONFIRMED then order to PROCESSING
        SH->>DB: history and audit
    else failure
        EXT--xCR: error or timeout
        SH->>DB: CREATING to CREATION_FAILED, store error and time
        Note over SH,DB: Order and payment untouched. Retry or change courier is allowed.
    end
    API-->>A: Result
```

## 3. Hand-over to courier

`CREATED -> SHIPPED` is a manual step by Admin/Manager (parcel handed over). Courier sync never does it for them.

## 4. Status sync (webhook and polling share one applier)

```mermaid
sequenceDiagram
    participant EXT as Courier
    participant WH as POST /api/webhooks/courier/code
    participant JOB as pollCourierStatus script
    participant SY as applyCourierStatusUpdate
    participant DB as PostgreSQL

    EXT->>WH: status webhook
    WH->>WH: Rate limit, verify signature on raw body
    WH->>DB: log courier_webhook_deliveries (signature valid or not)
    WH->>SY: update
    JOB->>EXT: fetch status for active shipments (batch)
    JOB->>SY: update

    Note over SY,DB: ONE transaction under order and shipment row locks
    SY->>DB: duplicate check
    SY->>DB: stale or out-of-order check (status_sequence)
    SY->>DB: apply SYSTEM transitions in order
    alt shipment reaches DELIVERED
        SY->>DB: order PROCESSING to DELIVERED
    else shipment reaches RETURNED
        SY->>DB: order PROCESSING to RETURNED and restore stock
    end
    SY->>DB: shipment_sync_events and order_status_history
    Note over SY,DB: If the order cascade fails, a savepoint rolls the shipment change back too.
```

Replayed or duplicated updates change nothing. An update needing `CREATED -> SHIPPED` is recorded as
`INVALID_TRANSITION` and applies on a later poll once an admin has marked the parcel shipped.

## 5. Customer tracking

```mermaid
sequenceDiagram
    actor C as Customer or Guest
    participant FE as /track-order
    participant API as Express API
    participant SY as courierSync.service
    participant EXT as Courier

    C->>FE: Enter courier tracking id
    FE->>API: POST /api/track-order (rate limited)
    API->>SY: refreshShipmentFromCourier
    Note over SY: One caller per cache window refreshes, others get the cached snapshot
    SY->>EXT: Fetch latest events
    alt provider fails
        SY-->>API: Serve cached data, internal state untouched
    end
    API-->>FE: Public-safe tracking timeline
```

## 6. Failure handling summary

| Failure | Shipment | Order | Payment |
| --- | --- | --- | --- |
| Create call fails | CREATION_FAILED | stays as is | unchanged |
| Delivery fails | DELIVERY_FAILED | stays PROCESSING | unchanged |
| Retry delivery | back to IN_TRANSIT | PROCESSING | unchanged |
| Parcel returned | RETURNED | RETURNED (atomic) | unchanged |
| Courier API down during tracking | cached data served | untouched | untouched |

## 7. Open items (from project notes)

- Steadfast adapter is not built; Pathao has no cancel, webhook or reference-lookup yet and runs on sandbox.
- Migrations 0016 to 0019 may not yet be applied to the real database.
