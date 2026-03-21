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
