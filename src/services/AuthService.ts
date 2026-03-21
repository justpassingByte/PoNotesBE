import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'villainvault-super-secret-key';

export class AuthService {
    /**
     * Register a new user
     */
    static async register(email: string, password: string) {
        const existing = await prisma.user.findUnique({
            where: { email }
        });

        if (existing) {
            throw new Error('Email is already registered');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                premium_tier: 'FREE' // default tier
            }
        });

        return user;
    }

    /**
     * Authenticate user and create a session
     */
    static async login(email: string, password: string, device_id: string = 'web-default') {
        const user = await prisma.user.findUnique({
            where: { email },
            include: { sessions: true }
        });

        if (!user) {
            throw new Error('Invalid credentials');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            throw new Error('Invalid credentials');
        }

        // Check device limit (optional but user asked for it in metadata)
        if (user.sessions.length >= user.max_devices) {
            // Option 1: Reject login
            // Option 2: Remove oldest session (let's do Option 2 for better UX)
            const oldestSession = user.sessions.sort((a, b) => a.created_at.getTime() - b.created_at.getTime())[0];
            await prisma.session.delete({ where: { id: oldestSession.id } });
        }

        // Create new session
        const session = await prisma.session.upsert({
            where: {
                user_id_device_id: {
                    user_id: user.id,
                    device_id,
                }
            },
            update: {
                last_active: new Date(),
            },
            create: {
                user_id: user.id,
                device_id,
            }
        });

        // Sign JWT with sessionId
        const token = jwt.sign(
            { 
                userId: user.id, 
                sessionId: session.id,
                email: user.email,
                tier: user.premium_tier 
            }, 
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        return { token, user: { id: user.id, email: user.email, tier: user.premium_tier } };
    }

    /**
     * Verify session exists and is active
     */
    static async verifySession(sessionId: string) {
        const session = await prisma.session.findUnique({
            where: { id: sessionId },
            include: { user: true }
        });

        if (!session) return null;

        // Update last active
        await prisma.session.update({
            where: { id: sessionId },
            data: { last_active: new Date() }
        });

        return session.user;
    }

    /**
     * Logout from a specific session
     */
    static async logout(sessionId: string) {
        try {
            await prisma.session.delete({ where: { id: sessionId } });
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Logout from ALL devices
     */
    static async logoutAllDevices(userId: string) {
        await prisma.session.deleteMany({
            where: { user_id: userId }
        });
        return true;
    }
}
