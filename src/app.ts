import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/errorHandler';

// Route Imports
import { playerRoutes } from './routes/playerRoutes';
import { noteRoutes } from './routes/noteRoutes';
import { templateRoutes } from './routes/templateRoutes';
import { platformRoutes } from './routes/platformRoutes';
import { settingsRoutes } from './routes/settingsRoutes';
import { playerStatsRoutes } from './routes/playerStatsRoutes';
import analyzeRoutes from './routes/analyzeRoutes';
import { playerProfileRoutes } from './routes/playerProfileRoutes';
import exploitRoutes from './routes/exploitRoutes';
import { solverRoutes } from './routes/solverRoutes';
import { sessionRoutes } from './routes/sessionRoutes';
import { handRoutes } from './routes/handRoutes';
import { paymentRoutes } from './routes/paymentRoutes';
import { authRoutes } from './routes/authRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import { adminRoutes } from './routes/adminRoutes';
import cookieParser from 'cookie-parser';
import { authMiddleware } from './middleware/authMiddleware';

const app = express();

// CORS
const allowedOrigins = [
    'http://localhost:3000',
    'https://po-notes-fe.vercel.app',
    process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
    origin: allowedOrigins as string[],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Health Check & Root
app.get('/', (req, res) => {
    res.json({
        name: 'VillainVault API',
        version: '2.0.0',
        status: 'running',
        endpoints: {
            health: '/health',
            players: '/api/players',
            notes: '/api/notes',
            hands: '/api/hands'
        }
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// API Routes
// Note: Sub-routes should come BEFORE generic parent routes if overlapping

// Auth routes manage their own public/private balance
app.use('/api/auth', authRoutes);

// All other /api routes require authentication
app.use('/api', authMiddleware);

// Protected API Routes
app.use('/api/players/:playerId/analyze', analyzeRoutes);
app.use('/api/players/:playerId/profile', playerProfileRoutes);
app.use('/api/players/:playerId/exploit', exploitRoutes);
app.use('/api/players/:playerId/stats', playerStatsRoutes);

app.use('/api/players', playerRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/platforms', platformRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/solve', solverRoutes);
app.use('/api/solver', solverRoutes); // Alias
app.use('/api/sessions', sessionRoutes);
app.use('/api/hands', handRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Global Error Handler
app.use(errorHandler);

export { app };
