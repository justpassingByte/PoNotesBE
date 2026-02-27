import { app } from './app';
import { config } from './config/unifiedConfig';

// Only start listening when running locally (not in Vercel serverless)
if (process.env.VERCEL !== '1') {
    const port = config.server.port;
    app.listen(port, () => {
        console.log(`🚀 Server is running on port ${port}`);
    });
}

// Export for Vercel serverless
export default app;
