import NodeCache from 'node-cache';

// Standard TTL 60 seconds
export const playerCache = new NodeCache({ stdTTL: 60, checkperiod: 30 });
export const dashboardCache = new NodeCache({ stdTTL: 60, checkperiod: 30 });

/**
 * Helper to clear player list cache for a specific user
 */
export function clearPlayerCache(userId: string) {
    const keys = playerCache.keys().filter(k => k.startsWith(`players_list_${userId}`));
    if (keys.length > 0) {
        playerCache.del(keys);
    }
}

/**
 * Helper to clear dashboard cache for a specific user
 */
export function clearDashboardCache(userId: string) {
    dashboardCache.del(`dashboard_${userId}`);
}
