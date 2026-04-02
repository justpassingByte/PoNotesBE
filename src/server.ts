import app from './app';
import { config } from './config/unifiedConfig';
import { invoiceExpiryWorker } from './core/invoiceExpiryWorker';
import { initBackupCron } from './controllers/backupController';

// Only start listening when running locally (not in Vercel serverless)
if (process.env.VERCEL !== '1') {
    const port = config.server.port;
    const server = app.listen(port, () => {
        console.log(`🚀 Server is running on port ${port}`);

        // Start background workers after server is up
        invoiceExpiryWorker.start();
        initBackupCron();
    });

    // Graceful shutdown
    const shutdown = () => {
        console.log('⏹ Shutting down server...');
        invoiceExpiryWorker.stop();
        server.close(() => process.exit(0));
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

// Export for Vercel serverless
export default app;
