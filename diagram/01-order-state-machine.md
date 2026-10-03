# 01 - Order, Payment and Shipment State Machine

Source: `.claude/project requirment documents/07-order-state-machine.md` (authoritative).
Code: `backend/src/services/orderStateMachine.ts`, `orderStatus.service.ts`, `shipmentStatus.service.ts`.

Three **independent** status fields live on every order. Shipment states (SHIPPED, IN_TRANSIT,
OUT_FOR_DELIVERY) never appear in the order status; the order stays `PROCESSING` while the shipment moves.

## 1. Order status (bKash and COD)

The only difference is the starting status.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> PENDING_CONFIRMATION: bKash order placed
    [*] --> COD_VERIFICATION_PENDING: COD order placed

    PENDING_CONFIRMATION --> CONFIRMED: bKash verified, Admin or Manager confirms
    COD_VERIFICATION_PENDING --> CONFIRMED: customer confirms by phone

    CONFIRMED --> PROCESSING: preparation begins
    PROCESSING --> DELIVERED: courier reports delivery (system)
    PROCESSING --> RETURNED: shipment RETURNED (system) or manual fallback

    PENDING_CONFIRMATION --> CANCELLED
    COD_VERIFICATION_PENDING --> CANCELLED
    CONFIRMED --> CANCELLED
    PROCESSING --> CANCELLED

    DELIVERED --> [*]
    CANCELLED --> [*]
    RETURNED --> [*]
```

Not allowed: `DELIVERED -> CANCELLED`, and any `DELIVERED -> RETURNED` (post-delivery returns are manual in v1).

## 2. Payment status

bKash payments start at `PENDING_VERIFICATION`; COD payments start at `PENDING_COLLECTION`.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> PENDING_VERIFICATION: bKash order
    PENDING_VERIFICATION --> PAID_VERIFIED: Admin or Manager verifies
    PENDING_VERIFICATION --> REJECTED: Admin or Manager rejects
    REJECTED --> PENDING_VERIFICATION: resubmission recorded

    [*] --> PENDING_COLLECTION: COD order
    PENDING_COLLECTION --> PAID_COLLECTED: cash collected by courier
    PENDING_COLLECTION --> REJECTED: manual, collection never happens
```

A rejected bKash payment does **not** cancel the order. For COD, `DELIVERED` + `PENDING_COLLECTION` can coexist
and is flagged in the Order Panel (computed at display time, not stored).

## 3. Shipment status

```mermaid
stateDiagram-v2
    [*] --> NOT_CREATED
    NOT_CREATED --> CREATING: Admin or Manager creates shipment
    CREATING --> CREATED: courier API ok
    CREATING --> CREATION_FAILED: courier API error
    CREATION_FAILED --> CREATING: retry or change courier
    CREATED --> SHIPPED
    SHIPPED --> IN_TRANSIT
    IN_TRANSIT --> OUT_FOR_DELIVERY
    OUT_FOR_DELIVERY --> DELIVERED
    OUT_FOR_DELIVERY --> DELIVERY_FAILED
    DELIVERY_FAILED --> IN_TRANSIT: retry delivery
    DELIVERY_FAILED --> RETURNED: parcel returned
    DELIVERED --> [*]
    RETURNED --> [*]
```

## 4. How shipment drives order (atomic cascade)

```mermaid
flowchart TD
    A["orderStatus = PROCESSING"] --> B["shipment moves:<br/>CREATED, SHIPPED, IN_TRANSIT, OUT_FOR_DELIVERY<br/>(order stays PROCESSING)"]
    B -->|shipment DELIVERED| C["ONE transaction:<br/>shipment DELIVERED + order DELIVERED"]
    B -->|DELIVERY_FAILED then RETURNED| D["ONE transaction:<br/>shipment RETURNED + order RETURNED<br/>+ stock restored"]
    B -->|CREATION_FAILED or DELIVERY_FAILED| E["order stays PROCESSING<br/>payment and order never auto-change"]
```

## 5. Side effects tied to transitions

| Transition | Side effect |
| --- | --- |
| `-> CONFIRMED` | Atomic stock decrement (insufficient stock blocks it); Meta `Purchase` event fires once after commit |
| `-> CANCELLED` | Stock restored; courier `Cancel Shipment` called if shipment is CREATED or later; reason, actor, timestamp stored |
| `-> RETURNED` | Stock restored |
| every change | Row appended to `order_status_history` (+ `audit_logs`) |
