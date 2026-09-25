import type { NextFunction, Request, Response } from 'express';
import { uploadHomepageImage } from '../../services/storage/homepageImages.service.js';
import { ValidationError } from '../../lib/errors.js';
import type { UploadImageQuery } from '../../validation/homepageCms.validation.js';
import type { ApiSuccess } from '../../types/api.js';

/** Homepage/campaign image upload (13-homepage-cms §13.11, plan §2). Body is the raw file bytes, per `createUploadLimit`'s `express.raw` contract. */
export async function uploadHomepageImageController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { kind } = req.query as unknown as UploadImageQuery;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new ValidationError('No file was uploaded.', [{ field: 'file', message: 'must not be empty' }]);
    }

    const result = await uploadHomepageImage({ file: req.body, kind });
    res.status(201).json({ data: { url: result.url } } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
