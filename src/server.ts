import { app } from './app';
import { config } from './config/unifiedConfig';

const startServer = () => {
    try {
        const port = config.server.port;

        app.listen(port, () => {
            console.log(`🚀 Server is running on port ${port}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
