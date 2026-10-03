import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { validate } from '../../middleware/validate.js';
import * as reports from '../../services/reports.service.js';
import * as exportsSvc from '../../services/reportExport.service.js';
import * as v from '../../validation/reports.validation.js';
import type { ApiSuccess } from '../../types/api.js';

/**
 * Back-office reports (spec 20, 05-admin §5.9). Auth + the authenticated ceiling are applied at the
 * admin router level; EVERY route here additionally requires `analytics.view` (Assigned for Manager,
 * §5.18) — hiding the nav entry is not the control. All handlers are read-only except POST /exports,
 * which only enqueues a job row.
 */
const router = Router();
router.use(requirePermission('analytics.view'));
// Financial figures and signed export links must never be stored by a browser cache or a shared proxy.
router.use((_req: Request, res: Response, next: NextFunction) => {
  res.set('Cache-Control', 'no-store');
  next();
});

type Q<S extends z.ZodTypeAny> = z.infer<S>;

/** Wraps an async handler so a rejection reaches the central error handler. */
const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

const single = (load: (q: any) => Promise<unknown>) =>
  handle(async (req, res) => {
    res.json({ data: await load(req.query) } satisfies ApiSuccess<unknown>);
  });

router.get('/config', handle(async (_req, res) => {
  res.json({ data: reports.getReportConfig() } satisfies ApiSuccess<unknown>);
}));

router.get('/sales/summary', validate({ query: v.reportRangeSchema }), single((q: Q<typeof v.reportRangeSchema>) => reports.getSalesSummary(q)));

router.get(
  '/sales/trend',
  validate({ query: v.trendQuerySchema }),
  single((q: Q<typeof v.trendQuerySchema>) => reports.getSalesTrend({ from: q.from, to: q.to }, q.granularity)),
);

router.get(
  '/sales/by-product',
  validate({ query: v.salesByProductQuerySchema }),
  handle(async (req, res) => {
    const q = req.query as unknown as Q<typeof v.salesByProductQuerySchema>;
    res.json(await reports.getSalesByProduct({ from: q.from, to: q.to }, q.sort, q.order, q));
  }),
);

router.get(
  '/sales/by-category',
  validate({ query: v.salesByCategoryQuerySchema }),
  handle(async (req, res) => {
    const q = req.query as unknown as Q<typeof v.salesByCategoryQuerySchema>;
    res.json(await reports.getSalesByCategory({ from: q.from, to: q.to }, q.sort, q.order, q));
  }),
);

router.get('/orders/summary', validate({ query: v.reportRangeSchema }), single((q: Q<typeof v.reportRangeSchema>) => reports.getOrdersSummary(q)));
router.get('/payments/summary', validate({ query: v.reportRangeSchema }), single((q: Q<typeof v.reportRangeSchema>) => reports.getPaymentsSummary(q)));

router.get(
  '/products/performance',
  validate({ query: v.productsPerformanceQuerySchema }),
  handle(async (req, res) => {
    const q = req.query as unknown as Q<typeof v.productsPerformanceQuerySchema>;
    res.json(await reports.getProductsPerformance({ from: q.from, to: q.to }, q.sort, q.order, q));
  }),
);

router.get(
  '/products/stock',
  validate({ query: v.productsStockQuerySchema }),
  handle(async (req, res) => {
    const q = req.query as unknown as Q<typeof v.productsStockQuerySchema>;
    res.json(await reports.getProductsStock(q.filter, q.sort, q.order, q));
  }),
);

router.get('/customers/summary', validate({ query: v.reportRangeSchema }), single((q: Q<typeof v.reportRangeSchema>) => reports.getCustomersSummary(q)));
router.get('/shipments/summary', validate({ query: v.reportRangeSchema }), single((q: Q<typeof v.reportRangeSchema>) => reports.getShipmentsSummary(q)));
router.get('/coupons/summary', validate({ query: v.reportRangeSchema }), single((q: Q<typeof v.reportRangeSchema>) => reports.getCouponsSummary(q)));

// ---- Asynchronous CSV exports (§11.4) --------------------------------------------------------------

router.post(
  '/exports',
  rateLimit('reportExport'),
  validate({ body: v.createExportSchema }),
  handle(async (req, res) => {
    const body = req.body as Q<typeof v.createExportSchema>;
    const created = await exportsSvc.createExport(req.actor!.userId, body.report, { from: body.from, to: body.to });
    res.status(202).json({ data: created } satisfies ApiSuccess<unknown>);
  }),
);

router.get(
  '/exports/:id',
  validate({ params: v.exportIdParamsSchema }),
  handle(async (req, res) => {
    const view = await exportsSvc.getExportStatus(req.params.id as string, req.actor!.userId);
    res.json({ data: view } satisfies ApiSuccess<unknown>);
  }),
);

export default router;
