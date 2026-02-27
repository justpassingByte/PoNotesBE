import { Router } from 'express';
import { PlayerController } from '../controllers/PlayerController';
import { PlayerService } from '../services/playerService';
import { PlayerRepository } from '../repositories/PlayerRepository';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();

// Dependency Injection Setup
const repository = new PlayerRepository();
const service = new PlayerService(repository);
const controller = new PlayerController(service);

router.get('/', asyncErrorWrapper((req, res) => controller.getAll(req, res)));
router.get('/export', asyncErrorWrapper((req, res) => controller.exportAll(req, res)));
router.post('/bulk', asyncErrorWrapper((req, res) => controller.bulkCreate(req, res)));
router.post('/', asyncErrorWrapper((req, res) => controller.create(req, res)));
router.get('/:id', asyncErrorWrapper((req, res) => controller.getById(req, res)));
router.put('/:id', asyncErrorWrapper((req, res) => controller.update(req, res)));
router.delete('/:id', asyncErrorWrapper((req, res) => controller.delete(req, res)));

export const playerRoutes = router;
