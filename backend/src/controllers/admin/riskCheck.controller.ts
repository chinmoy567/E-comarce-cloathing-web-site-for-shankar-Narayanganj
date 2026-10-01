import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as customerRiskService from '../../services/fraud/customerRiskService.js';
import type { ApiSuccess } from '../../types/api.js';

/**
 * Spec 16 controllers. Thin: parse, call the service, let the central error
 * handler map typed errors. Neither response can carry `raw_result` — the
 * service's `RiskCheckResponse` type has no field for it.
 */

export async function getRiskCheckController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await customerRiskService.getRiskCheck(req.params.orderNumber as string);
    res.json({ data } satisfies ApiSuccess<customerRiskService.RiskCheckResponse>);
  } catch (err) {
    next(err);
  }
}

export async function postRiskCheckController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.actor?.userId;
    if (!userId) throw new UnauthorizedError('Authentication required.');
    const data = await customerRiskService.runRiskCheck(req.params.orderNumber as string, { userId }, req.requestId);
    res.json({ data } satisfies ApiSuccess<customerRiskService.RiskCheckResponse>);
  } catch (err) {
    if (err instanceof customerRiskService.CustomerRiskRateLimitError) {
      res.setHeader('Retry-After', String(err.retryAfterSec));
    }
    next(err);
  }
}
