-- 0019_pathao_courier.sql — spec 14, Pathao adapter
-- Pathao's merchant API has no working cancel endpoint (the sandbox answers
-- "Unauthorized!" to POST /orders/{id}/cancel), so cancelling an order whose parcel
-- exists must say so up front instead of calling the courier. supports_reference_lookup
-- stays false: the API has no lookup by merchant order id.
-- Forward-only: never edit after it has been applied. The runner wraps this file in BEGIN/COMMIT.

UPDATE couriers SET supports_cancel = false WHERE code = 'PATHAO';
