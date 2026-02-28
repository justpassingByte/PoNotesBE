import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// CORS — allow frontend origins
const allowedOrigins = [
    'http://localhost:3000',
    'https://po-notes-fe.vercel.app',
    process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
    origin: allowedOrigins as string[],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
}));
app.use(express.json());

import { playerRoutes } from './routes/playerRoutes';
import { noteRoutes } from './routes/noteRoutes';
import { templateRoutes } from './routes/templateRoutes';
import { platformRoutes } from './routes/platformRoutes';

// Routes
app.get('/', (req, res) => {
    res.json({
        name: 'VillainVault API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            health: '/health',
            players: '/api/players',
            notes: '/api/notes',
            templates: '/api/templates',
            platforms: '/api/platforms'
        }
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

app.use('/api/players', playerRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/platforms', platformRoutes);

// Global Error Handler
app.use(errorHandler);

export { app };
