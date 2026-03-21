import { Router } from 'express';
import { NoteController } from '../controllers/NoteController';
import { NoteService } from '../services/noteService';
import { NoteRepository } from '../repositories/NoteRepository';
import { PlayerService } from '../services/playerService';
import { PlayerRepository } from '../repositories/PlayerRepository';
import { asyncErrorWrapper } from '../utils/asyncErrorWrapper';

const router = Router();

// Dependency Injection Setup
const repository = new NoteRepository();
const playerRepository = new PlayerRepository();
const playerService = new PlayerService(playerRepository);
const service = new NoteService(repository, playerService);
const controller = new NoteController(service);

router.get('/player/:playerId', asyncErrorWrapper((req, res) => controller.getByPlayer(req, res)));
router.post('/', asyncErrorWrapper((req, res) => controller.create(req, res)));
router.put('/:id', asyncErrorWrapper((req, res) => controller.update(req, res)));
router.delete('/:id', asyncErrorWrapper((req, res) => controller.delete(req, res)));

export const noteRoutes = router;
