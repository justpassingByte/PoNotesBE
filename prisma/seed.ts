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
            premium_tier: 'PRO_PLUS'
        },
        create: {
            email: 'admin',
            password: adminPassword,
            premium_tier: 'PRO_PLUS',
            max_devices: 5
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
            features: ["2 AI Analysis / Day", "5 Name OCR / Day", "2 Full Hand OCR / Day", "Basic Player Profiles"],
            ai_limit: 2,
            ocr_limit: 2,
            is_popular: false,
            color_theme: "blue"
        },
        {
            id: "PRO",
            name: "Pro",
            price: 29,
            description: "For serious grinders playing multiple sessions per week.",
            features: ["100 AI Analysis / Month", "100 Full OCR / Month", "Advanced Leak Detection", "Exploit Strategy"],
            ai_limit: 100,
            ocr_limit: 100,
            is_popular: true,
            color_theme: "gold"
        },
        {
            id: "PRO_PLUS",
            name: "Elite",
            price: 59,
            description: "Unleash the full power of Claude 3.5 Sonnet logic.",
            features: ["500 AI Analysis / Month", "300 Full OCR / Month", "GTO Baseline Comparison", "VGG OCR"],
            ai_limit: 500,
            ocr_limit: 300,
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
    const wptPlatform = await prisma.platform.upsert({
        where: { name: 'WPT Poker' },
        update: {},
        create: { name: 'WPT Poker' },
    });

    const ggPlatform = await prisma.platform.upsert({
        where: { name: 'GG Poker' },
        update: {},
        create: { name: 'GG Poker' },
    });

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

    for (const t of templatesData) {
        await prisma.template.create({
            data: t
        });
    }
    console.log('Created note templates.');

    // 3. Create Mock Players
    const player1 = await prisma.player.create({
        data: {
            user_id: admin.id,
            name: 'PhilIveyFan99',
            platform_id: wptPlatform.id,
            playstyle: 'LAG',
            aggression_score: 55,
            notes: {
                create: [
                    { user_id: admin.id, street: 'Preflop', note_type: 'Template', content: '3-bet light' },
                    { user_id: admin.id, street: 'Flop', note_type: 'Template', content: 'C-bet 100%' }
                ]
            }
        }
    });

    const player2 = await prisma.player.create({
        data: {
            user_id: admin.id,
            name: 'NitMasterFlex',
            platform_id: ggPlatform.id,
            playstyle: 'Nit',
            aggression_score: -15,
            notes: {
                create: [
                    { user_id: admin.id, street: 'River', note_type: 'Template', content: 'Never bluffs river' },
                    { user_id: admin.id, street: 'Turn', note_type: 'Template', content: 'Overfold to turn barrel' }
                ]
            }
        }
    });

    console.log('Created mock players and notes.');

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
