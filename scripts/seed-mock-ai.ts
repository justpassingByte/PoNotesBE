import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

function getHandStr(r1: string, r2: string, i: number, j: number) {
    if (i === j) return r1 + r2;
    if (i < j) return r1 + r2 + 's';
    return r2 + r1 + 'o';
}

async function main() {
    // Find the first player in the database
    const player = await prisma.player.findFirst();
    if (!player) {
        console.log("No player found in the database. Please add a player first.");
        return;
    }

    // Generate Mock 13x13 Matrix
    const aiRangeMatrix: Record<string, { Raise: number, Call: number, Fold: number }> = {};
    for (let i = 0; i < RANKS.length; i++) {
        for (let j = 0; j < RANKS.length; j++) {
            const hand = getHandStr(RANKS[i], RANKS[j], i, j);
            if (i < 4 && j < 4) {
                aiRangeMatrix[hand] = { Raise: 100, Call: 0, Fold: 0 };
            } else if (i < 8 && j < 8) {
                aiRangeMatrix[hand] = { Raise: 0, Call: 100, Fold: 0 };
            } else if (i === j) {
                aiRangeMatrix[hand] = { Raise: 100, Call: 0, Fold: 0 };
            } else if (i < 4 || j < 4) {
                aiRangeMatrix[hand] = { Raise: 75, Call: 25, Fold: 0 };
            } else {
                aiRangeMatrix[hand] = { Raise: 0, Call: 0, Fold: 100 };
            }
        }
    }

    // Mock Action Breakdown
    const aiActionBreakdown = { Raise: 48, Call: 22, Fold: 30 };

    console.log(`Seeding data for player: ${player.name}...`);

    // Inject into Database
    await prisma.player.update({
        where: { id: player.id },
        data: {
            ai_range_matrix: aiRangeMatrix,
            ai_action_breakdown: aiActionBreakdown,
            ai_exploit_strategy: "This is a seeded mock 'Strategic Insight' designed to fill the natural language paragraph at the bottom of the strategy guide. It confirms that the backend API is successfully transmitting the full JSON payload and the frontend is securely binding the live variables to the UI components.",
            ai_playstyle: "LAG",
            ai_aggression_level: "Aggressive",
            ai_aggression_score: 85,
            ai_analysis_mode: "advanced",
            ai_stats_used: JSON.stringify(["VPIP%", "RFI%"]),
            ai_last_analyzed_at: new Date()
        }
    });

    console.log("✅ Successfully injected mock JSON Matrix into the Database!");
}

main().catch(e => {
    console.error(e);
    process.exit(1);
}).finally(async () => {
    await prisma.$disconnect();
});
