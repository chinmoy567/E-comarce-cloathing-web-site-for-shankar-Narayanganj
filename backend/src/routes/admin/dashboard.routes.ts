import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import { getDashboardSummary } from '../../services/adminDashboard.service.js';
import type { ApiSuccess } from '../../types/api.js';

/** Admin dashboard counters (spec 13, 05-admin §5.2). Auth/rate-limit applied at the admin router level. */
const router = Router();

const summaryQuerySchema = z.object({ since: z.coerce.date().optional() }).strict();

router.get(
  '/summary',
  requirePermission('dashboard.view'),
  validate({ query: summaryQuerySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { since } = req.query as unknown as z.infer<typeof summaryQuerySchema>;
      res.json({ data: await getDashboardSummary(since) } satisfies ApiSuccess<unknown>);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
