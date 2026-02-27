import { Router } from 'express';
import { TemplateController } from '../controllers/TemplateController';
import { TemplateService } from '../services/templateService';
import { TemplateRepository } from '../repositories/TemplateRepository';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();

// Dependency Injection layer matching backend guidelines
const repository = new TemplateRepository();
const service = new TemplateService(repository);
const controller = new TemplateController(service);

router.get('/', asyncErrorWrapper((req, res) => controller.getAll(req, res)));
router.post('/', asyncErrorWrapper((req, res) => controller.create(req, res)));
router.put('/:id', asyncErrorWrapper((req, res) => controller.update(req, res)));
router.delete('/:id', asyncErrorWrapper((req, res) => controller.delete(req, res)));

export const templateRoutes = router;
