-- 0027_steadfast_courier.sql — Steadfast adapter (04-courier §4.9, §4.11)
-- Steadfast's API has no cancel endpoint (only a return request, a different operation), so
-- cancelling an order whose parcel exists must say so up front instead of calling the courier.
-- supports_reference_lookup = true: GET /trackings_by_invoice/{invoice} finds a parcel by our
-- order number, and Steadfast refuses a repeated invoice, so a retry after an unknown outcome
-- with the SAME courier cannot create a duplicate parcel.
-- is_enabled is deliberately untouched: an admin enables Steadfast in Settings > Couriers.
-- Forward-only: never edit after it has been applied. The runner wraps this file in BEGIN/COMMIT.

UPDATE couriers
   SET supports_cancel = false,
       supports_reference_lookup = true
 WHERE code = 'STEADFAST';
