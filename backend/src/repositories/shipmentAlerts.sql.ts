/**
 * Shipment alert predicates shared by the dashboard counters and the order-list filters,
 * so a card and the list it opens can never disagree (spec 13, 05-admin §5.2). Each one
 * reads the `shipments` row aliased `sh`. Nothing here is stored: all computed per query.
 */

/** Shipment states in which a parcel exists and is still on its way. */
export const ACTIVE_PARCEL_STATES_SQL = `('CREATED','SHIPPED','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERY_FAILED')`;

/** Courier sync hit a failure a person must look at (unrecognized status, rejected credentials, unknown parcel). */
export const COURIER_ATTENTION_SQL = `(sh.sync_problem IS NOT NULL AND sh.shipment_status IN ${ACTIVE_PARCEL_STATES_SQL})`;

/** A parcel whose status has not changed for `daysParam` days. */
export const parcelStuckSql = (daysParam: string) =>
  `(sh.shipment_status IN ${ACTIVE_PARCEL_STATES_SQL} AND sh.status_changed_at < now() - (${daysParam}::int * interval '1 day'))`;

/** Window for the "returned recently" view: parcels coming back to the store. */
export const RETURNED_RECENT_DAYS = 30;
export const RETURNED_RECENT_SQL = `(sh.shipment_status = 'RETURNED' AND sh.status_changed_at >= now() - interval '${RETURNED_RECENT_DAYS} days')`;
