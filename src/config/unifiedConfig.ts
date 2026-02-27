import 'dotenv/config';

export const config = {
    server: {
        port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
    },
    database: {
        url: process.env.DATABASE_URL,
        directUrl: process.env.DIRECT_URL,
    }
};
