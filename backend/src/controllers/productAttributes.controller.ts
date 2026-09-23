import type { NextFunction, Request, Response } from 'express';
import { withTransaction } from '../lib/transaction.js';
import { NotFoundError } from '../lib/errors.js';
import * as productAttributesRepository from '../repositories/productAttributes.repository.js';
import * as auditRepository from '../repositories/audit.repository.js';
import type {
  CreateAttributeInput,
  CreateAttributeValueInput,
} from '../validation/catalogue.validation.js';
import type { ApiSuccess } from '../types/api.js';

/**
 * Attribute (Size/Colour/Age group/Other) management (spec 05 §Routes).
 * Thin CRUD with no cross-entity orchestration, so it goes straight to the
 * repository rather than through a dedicated service, matching the existing
 * controller-granularity precedent.
 */

function actorId(req: Pick<Request, 'actor'>): string {
  return req.actor!.userId;
}

export async function listAttributesController(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await productAttributesRepository.listAll();
    const withValues = await Promise.all(
      items.map(async (attribute) => ({
        ...attribute,
        values: await productAttributesRepository.listValuesForAttribute(attribute.id),
      })),
    );
    res.status(200).json({ data: withValues } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function createAttributeController(
  req: Request<unknown, unknown, CreateAttributeInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await withTransaction(async (client) => {
      const created = await productAttributesRepository.create(req.body, client);
      await auditRepository.append(
        {
          entityType: 'product_attribute',
          entityId: created.id,
          action: 'attribute_created',
          newValue: { type: created.type, name: created.name },
          actorUserId: actorId(req),
          actorType: 'USER',
        },
        client,
      );
      return created;
    });
    res.status(201).json({ data: { ...result, values: [] } } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function createAttributeValueController(
  req: Request<{ id: string }, unknown, CreateAttributeValueInput>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await withTransaction(async (client) => {
      const attribute = await productAttributesRepository.findById(req.params.id, client);
      if (!attribute) {
        throw new NotFoundError('Attribute not found.');
      }

      const created = await productAttributesRepository.createValue(
        { attributeId: req.params.id, value: req.body.value, displayOrder: req.body.displayOrder },
        client,
      );

      await auditRepository.append(
        {
          entityType: 'product_attribute_value',
          entityId: created.id,
          action: 'attribute_value_created',
          newValue: { attributeId: req.params.id, value: created.value },
          actorUserId: actorId(req),
          actorType: 'USER',
        },
        client,
      );

      return created;
    });
    res.status(201).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function deleteAttributeValueController(
  req: Request<{ id: string; valueId: string }>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await withTransaction(async (client) => {
      await productAttributesRepository.removeValue(req.params.id, req.params.valueId, client);
      await auditRepository.append(
        {
          entityType: 'product_attribute_value',
          entityId: req.params.valueId,
          action: 'attribute_value_deleted',
          previousValue: { attributeId: req.params.id },
          actorUserId: actorId(req),
          actorType: 'USER',
        },
        client,
      );
    });
    res.status(200).json({ data: { deleted: true } } satisfies ApiSuccess<{ deleted: true }>);
  } catch (err) {
    next(err);
  }
}
