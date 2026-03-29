import 'dotenv/config';

export const config = {
    server: {
        port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
    },
    database: {
        url: process.env.DATABASE_URL,
        directUrl: process.env.DIRECT_URL,
    },
    nowpayments: {
        apiKey: process.env.NOWPAYMENTS_API_KEY || '',
        ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET || '',
        apiUrl: process.env.NOWPAYMENTS_API_URL || 'https://api.nowpayments.io/v1',
        sandboxApiUrl: 'https://api-sandbox.nowpayments.io/v1',
        isSandbox: process.env.NOWPAYMENTS_SANDBOX === 'true',
        successUrl: process.env.NOWPAYMENTS_SUCCESS_URL || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/pricing?payment=success`,
        cancelUrl: process.env.NOWPAYMENTS_CANCEL_URL || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/pricing?payment=cancelled`,
    },
    frontend: {
        url: process.env.FRONTEND_URL || 'http://localhost:3000',
    },
    email: {
        resendApiKey: process.env.RESEND_API_KEY || '',
        from: process.env.EMAIL_FROM || 'VillainVault <noreply@villainvault.com>',
    },
};
