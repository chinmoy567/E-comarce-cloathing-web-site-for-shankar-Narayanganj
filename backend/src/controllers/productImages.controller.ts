import type { NextFunction, Request, Response } from 'express';
import * as productImagesService from '../services/productImages.service.js';
import { ValidationError } from '../lib/errors.js';
import type { UploadImageQuery } from '../validation/catalogue.validation.js';
import type { ApiSuccess } from '../types/api.js';

function actorOf(req: Pick<Request, 'actor'>): productImagesService.Actor {
  return { userId: req.actor!.userId };
}

/** POST /products/:id/images — the body is the raw image bytes (`createUploadLimit`), alt text is a query param. */
export async function uploadProductImageController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new ValidationError('No file was uploaded.', [{ field: 'file', message: 'must not be empty' }], 'FILE_REQUIRED');
    }
    const { altText } = req.query as unknown as UploadImageQuery;
    const image = await productImagesService.uploadProductImage(
      actorOf(req),
      req.params.id as string,
      req.body,
      altText,
      req.requestId,
    );
    res.status(201).json({ data: image } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function reorderProductImagesController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const images = await productImagesService.reorderProductImages(
      actorOf(req),
      req.params.id as string,
      (req.body as { imageIds: string[] }).imageIds,
      req.requestId,
    );
    res.json({ data: images } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function updateImageController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const image = await productImagesService.updateImageAltText(
      actorOf(req),
      req.params.id as string,
      (req.body as { altText: string | null }).altText,
      req.requestId,
    );
    res.json({ data: image } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function setPrimaryImageController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({
      data: await productImagesService.setPrimaryImage(actorOf(req), req.params.id as string, req.requestId),
    } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}

export async function deleteImageController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({
      data: await productImagesService.deleteProductImage(actorOf(req), req.params.id as string, req.requestId),
    } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
