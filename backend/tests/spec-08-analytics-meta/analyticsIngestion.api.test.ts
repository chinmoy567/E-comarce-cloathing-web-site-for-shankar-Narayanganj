/**
 * Spec 08 — Analytics Event Ingestion API Tests
 *
 * Integration tests for POST /api/analytics/event endpoint.
 * These tests would require: (1) a fully running Express server,
 * (2) a testDb fixture with the meta_event_log table, and (3) a
 * request helper. They are deferred to a future session when the
 * broader test infrastructure for API tests is mature.
 *
 * For now, unit tests (metaEvents.contract, metaUserData) validate
 * the core contract; integration testing is manual or runs in CI.
 */

import { describe, it } from 'vitest';

describe('POST /api/analytics/event integration tests (deferred)', () => {
  it('placeholder for future integration tests', () => {
    // TODO: Accept valid non-Purchase event with 200
    // TODO: Record event in meta_event_log
    // TODO: Reject Purchase events with 400
    // TODO: Reject requests with value field
    // TODO: Reject unknown payload fields (strict mode)
    // TODO: Accept Search event with searchString
    // TODO: Accept AddToCart with contentIds
    // TODO: Reject missing eventId
    // TODO: Reject invalid eventId (not UUID)
    // TODO: Verify rate limiting via publicCeiling limiter
  });
});
