import type { NextFunction, Request, Response } from 'express';
import * as homepageService from '../services/homepageCms/homepage.service.js';
import type { ApiSuccess } from '../types/api.js';

/** Public homepage endpoint (13-homepage-cms §13.8, §13.15, plan §3.6). One request, fully resolved. */
export async function getHomepageController(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await homepageService.getHomepage();
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.status(200).json({ data: result } satisfies ApiSuccess<unknown>);
  } catch (err) {
    next(err);
  }
}
