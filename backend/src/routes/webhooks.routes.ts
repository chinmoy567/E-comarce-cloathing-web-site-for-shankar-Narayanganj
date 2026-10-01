import { Router } from 'express';
import { courierWebhookController } from '../controllers/courierWebhook.controller.js';
import { rateLimit } from '../middleware/rateLimit.js';

/**
 * Inbound provider webhooks (spec 15). Mounted at `/api/webhooks`. Rate-limited so the
 * endpoint cannot become a DoS vector (11-security §11.8); authenticity comes from the
 * provider signature checked in the controller, not from a session.
 */
const router = Router();

router.post('/courier/:courierCode', rateLimit('publicCeiling'), courierWebhookController);

export default router;
