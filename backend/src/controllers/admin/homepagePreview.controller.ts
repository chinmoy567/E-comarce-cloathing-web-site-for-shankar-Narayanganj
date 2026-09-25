import type { NextFunction, Request, Response } from 'express';
import * as previewService from '../../services/homepageCms/preview.service.js';
import type { ApiSuccess } from '../../types/api.js';

/**
 * Admin homepage preview (13-homepage-cms §13.12, plan §3.7). A structurally
 * separate route/controller from the public homepage endpoint — never a
 * flag/param on it — so unpublished content cannot leak through the public
 * surface.
 */
export async function getPreviewController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await previewService.getPreview();
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
