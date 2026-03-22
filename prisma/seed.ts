import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding the database...');

    // 0. Create Admin User
    const adminPassword = await bcrypt.hash('admin', 10);
    const admin = await prisma.user.upsert({
        where: { email: 'admin' },
        update: { 
            password: adminPassword,
            premium_tier: 'PRO_PLUS',
            is_admin: true
        },
        create: {
            email: 'admin',
            password: adminPassword,
            premium_tier: 'PRO_PLUS',
            max_devices: 5,
            is_admin: true
        }
    });
    console.log('Created/Updated admin user.');
    
    // 0.1 Create Pricing Plans
    const plans = [
        {
            id: "FREE",
            name: "Trial",
            price: 0,
            description: "Standard access for casual players wanting to see what AI can do.",
            features: ["Full Hand OCR", "Basic Player Profiles"],
            ai_limit: 2,
            name_ocr_limit: 10,
            hand_ocr_limit: 5,
            max_devices: 1,
            is_popular: false,
            color_theme: "blue"
        },
        {
            id: "PRO",
            name: "Pro",
            price: 29,
            description: "For serious grinders playing multiple sessions per week.",
            features: ["Full Hand OCR", "Leak Detection", "Exploit Finder"],
            ai_limit: 100,
            name_ocr_limit: 500,
            hand_ocr_limit: 200,
            max_devices: 2,
            is_popular: true,
            color_theme: "gold"
        },
        {
            id: "PRO_PLUS",
            name: "Elite",
            price: 59,
            description: "Unleash the full power of Claude 3.5 Sonnet logic.",
            features: ["Full Hand OCR", "Leak Detection", "Exploit Finder", "Premium VGG OCR"],
            ai_limit: 500,
            name_ocr_limit: 2000,
            hand_ocr_limit: 1000,
            max_devices: 5,
            is_popular: false,
            color_theme: "purple"
        }
    ];

    for (const plan of plans) {
        await (prisma as any).pricingPlan.upsert({
            where: { id: plan.id },
            update: plan,
            create: plan
        });
    }
    console.log('Created/Updated pricing plans.');

    // 1. Create Platforms
    const platforms = ['WPT Poker', 'GG Poker', 'PokerStars', '888Poker', 'CoinPoker'];
    for (const p of platforms) {
        await prisma.platform.upsert({
            where: { name: p },
            update: {},
            create: { name: p },
        });
    }

    console.log('Created platforms.');

    // 2. Create Templates
    const templatesData = [
        { label: '3-bet light', category: 'Preflop', weight: 3 },
        { label: 'Limp/call wide', category: 'Preflop', weight: -1 },
        { label: 'Overfold to 4-bet', category: 'Preflop', weight: -2 },
        { label: 'Open too wide BTN', category: 'Preflop', weight: 2 },
        { label: 'C-bet 100%', category: 'Postflop', weight: 3 },
        { label: 'Check-raise bluff', category: 'Postflop', weight: 3 },
        { label: 'Overfold to turn barrel', category: 'Postflop', weight: -2 },
        { label: 'Call down light', category: 'Postflop', weight: -1 },
        { label: 'Never bluffs river', category: 'Postflop', weight: -3 },
    ];

    // Use transaction to avoid duplicates if run multiple times
    for (const t of templatesData) {
        const existing = await prisma.template.findFirst({ where: { label: t.label } });
        if (!existing) {
            await prisma.template.create({ data: t });
        }
    }
    console.log('Created note templates.');

    console.log('Seeding finished.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
