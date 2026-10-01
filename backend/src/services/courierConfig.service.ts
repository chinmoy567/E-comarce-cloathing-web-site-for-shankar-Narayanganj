/**
 * Courier configuration (spec 14, `courier.manage`).
 *
 * Only NON-secret settings live in couriers.config. Writes are an allowlist per
 * adapter (its declared configSchema), so a secret can never be stored here
 * through the API: adapters declare no secret keys (§4.8, §11.9).
 */

import { NotFoundError, ValidationError } from '../lib/errors.js';
import { withTransaction } from '../lib/transaction.js';
import { append as appendAudit } from '../repositories/audit.repository.js';
import * as couriersRepository from '../repositories/couriers.repository.js';
import type { CourierRow } from '../repositories/couriers.repository.js';
import type { UpdateCourierConfigBody } from '../validation/shipment.validation.js';
import { configSchemaFor, isCourierConfigured } from './courier/courierService.js';
import type { CourierConfigField } from './courier/types.js';

export type CourierOption = { code: string; name: string };

export type CourierConfigView = {
  code: string;
  name: string;
  isEnabled: boolean;
  displayOrder: number;
  trackingUrlTemplate: string | null;
  supportsCancel: boolean;
  supportsTracking: boolean;
  credentialsConfigured: boolean;
  config: Record<string, string | number>;
  configSchema: CourierConfigField[];
};

function toView(row: CourierRow): CourierConfigView {
  const schema = [...configSchemaFor(row)];
  const allowed = new Set(schema.map((f) => f.key));
  const config: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(row.config ?? {})) {
    if (allowed.has(k) && (typeof v === 'string' || typeof v === 'number')) config[k] = v;
  }
  return {
    code: row.code,
    name: row.name,
    isEnabled: row.is_enabled,
    displayOrder: row.display_order,
    trackingUrlTemplate: row.tracking_url_template,
    supportsCancel: row.supports_cancel,
    supportsTracking: row.supports_tracking,
    // Presence check only — never a value.
    credentialsConfigured: isCourierConfigured(row),
    config,
    configSchema: schema,
  };
}

/** GET /couriers — enabled couriers only, in display order. */
export async function listCourierOptions(): Promise<CourierOption[]> {
  return (await couriersRepository.listEnabled()).map((c) => ({ code: c.code, name: c.name }));
}

export async function listCourierConfig(): Promise<CourierConfigView[]> {
  return (await couriersRepository.listAll()).map(toView);
}

export async function updateCourierConfig(
  code: string,
  update: UpdateCourierConfigBody,
  actor: { userId: string },
  requestId?: string,
): Promise<CourierConfigView> {
  const existing = await couriersRepository.getByCode(code);
  if (!existing) throw new NotFoundError('Courier not found.');

  if (update.config) {
    const allowed = new Map(configSchemaFor(existing).map((f) => [f.key, f]));
    const details = Object.entries(update.config).flatMap(([key, value]) => {
      const field = allowed.get(key);
      if (!field) return [{ field: `config.${key}`, message: 'Unknown setting.' }];
      if (typeof value !== field.type) return [{ field: `config.${key}`, message: `Must be a ${field.type}.` }];
      return [];
    });
    if (details.length > 0) throw new ValidationError('Invalid courier settings.', details);
  }

  const updated = await withTransaction(async (client) => {
    const row = await couriersRepository.updateConfig(client, code, {
      isEnabled: update.isEnabled,
      displayOrder: update.displayOrder,
      trackingUrlTemplate: update.trackingUrlTemplate,
      // Merge so a partial PATCH never drops other non-secret keys.
      config: update.config ? { ...(existing.config ?? {}), ...update.config } : undefined,
    });
    if (!row) throw new NotFoundError('Courier not found.');
    await appendAudit(
      {
        entityType: 'courier',
        action: 'courier_config_update',
        previousValue: { code, isEnabled: existing.is_enabled, displayOrder: existing.display_order },
        newValue: { code, isEnabled: row.is_enabled, displayOrder: row.display_order, configKeys: Object.keys(update.config ?? {}) },
        actorUserId: actor.userId,
        actorType: 'USER',
        requestId,
      },
      client,
    );
    return row;
  });
  return toView(updated);
}
