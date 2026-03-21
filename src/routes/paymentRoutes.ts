import { Router } from 'express';
import { PaymentController } from '../controllers/PaymentController';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();

const controller = new PaymentController();

router.post('/create-invoice', asyncErrorWrapper((req, res) => controller.createInvoice(req, res)));
router.post('/webhook', asyncErrorWrapper((req, res) => controller.handleWebhook(req, res)));

export const paymentRoutes = router;
