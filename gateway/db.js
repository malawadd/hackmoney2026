/**
 * SQLite Database Module for Arcent Gateway
 * Uses Turso (LibSQL) for persistent storage on serverless
 */

import { createClient } from '@libsql/client';

// Initialize Turso client
const db = createClient({
    url: process.env.TURSO_DATABASE_URL || 'file:arcent.db',
    authToken: process.env.TURSO_AUTH_TOKEN
});

console.log('[DB] Turso database client initialized');

// Initialize tables
async function initDatabase() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                provider TEXT NOT NULL,
                service_type TEXT,
                amount TEXT NOT NULL,
                tx_hash TEXT,
                status TEXT NOT NULL,
                latency_ms INTEGER,
                agent_id TEXT,
                query TEXT
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS provider_stats (
                provider TEXT PRIMARY KEY,
                success INTEGER DEFAULT 0,
                failure INTEGER DEFAULT 0,
                total_latency_ms INTEGER DEFAULT 0,
                last_updated TEXT
            )
        `);

        await db.execute(`CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_transactions_provider ON transactions(provider)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)`);

        // Yellow Network tables
        await db.execute(`
            CREATE TABLE IF NOT EXISTS yellow_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT UNIQUE NOT NULL,
                participant_a TEXT,
                participant_b TEXT,
                status TEXT DEFAULT 'open',
                allocations TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS yellow_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                from_address TEXT,
                to_address TEXT,
                asset TEXT,
                amount TEXT,
                tx_type TEXT DEFAULT 'payment',
                timestamp TEXT NOT NULL
            )
        `);

        await db.execute(`CREATE INDEX IF NOT EXISTS idx_yellow_sessions_status ON yellow_sessions(status)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_yellow_transactions_session ON yellow_transactions(session_id)`);

        console.log('[DB] Database tables initialized');
    } catch (error) {
        console.error('[DB] Failed to initialize database:', error.message);
    }
}

// Run initialization
initDatabase();

/**
 * Save a transaction to the database
 */
export async function saveTransaction(tx) {
    try {
        await db.execute({
            sql: `INSERT INTO transactions (timestamp, provider, service_type, amount, tx_hash, status, latency_ms, agent_id, query)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                tx.timestamp || new Date().toISOString(),
                tx.provider || 'unknown',
                tx.serviceType || null,
                tx.amount || '0',
                tx.txHash || null,
                tx.status || 'unknown',
                tx.latencyMs || null,
                tx.agentId || null,
                tx.query || null
            ]
        });
        console.log('[DB] Transaction saved:', tx.txHash?.slice(0, 10) || 'no-hash');
        return true;
    } catch (error) {
        console.error('[DB] Failed to save transaction:', error.message);
        return false;
    }
}

/**
 * Update provider stats in database (incremental)
 */
export async function persistProviderStats(provider, isSuccess, latencyMs) {
    try {
        await db.execute({
            sql: `INSERT INTO provider_stats (provider, success, failure, total_latency_ms, last_updated)
                  VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(provider) DO UPDATE SET
                    success = success + excluded.success,
                    failure = failure + excluded.failure,
                    total_latency_ms = total_latency_ms + excluded.total_latency_ms,
                    last_updated = excluded.last_updated`,
            args: [
                provider,
                isSuccess ? 1 : 0,
                isSuccess ? 0 : 1,
                latencyMs || 0,
                new Date().toISOString()
            ]
        });
        return true;
    } catch (error) {
        console.error('[DB] Failed to update provider stats:', error.message);
        return false;
    }
}

/**
 * Load all provider stats from database (for server startup)
 */
export async function loadProviderStats() {
    try {
        const result = await db.execute(`SELECT * FROM provider_stats`);
        const stats = {};
        for (const row of result.rows) {
            stats[row.provider] = {
                success: row.success,
                failure: row.failure,
                totalLatency: row.total_latency_ms
            };
        }
        return stats;
    } catch (error) {
        console.error('[DB] Failed to load provider stats:', error.message);
        return {};
    }
}

/**
 * Get transaction history
 */
export async function getTransactionHistory(limit = 50) {
    try {
        const result = await db.execute({
            sql: `SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?`,
            args: [limit]
        });
        return result.rows;
    } catch (error) {
        console.error('[DB] Failed to get transaction history:', error.message);
        return [];
    }
}

/**
 * Get transactions by provider
 */
export async function getTransactionsByProvider(provider, limit = 50) {
    try {
        const result = await db.execute({
            sql: `SELECT * FROM transactions WHERE provider = ? ORDER BY timestamp DESC LIMIT ?`,
            args: [provider, limit]
        });
        return result.rows;
    } catch (error) {
        console.error('[DB] Failed to get transactions by provider:', error.message);
        return [];
    }
}

/**
 * Get database stats
 */
export async function getDatabaseStats() {
    try {
        const transactionCount = await db.execute('SELECT COUNT(*) as count FROM transactions');
        const providerCount = await db.execute('SELECT COUNT(*) as count FROM provider_stats');
        return {
            transactions: transactionCount.rows[0]?.count || 0,
            providers: providerCount.rows[0]?.count || 0,
            dbType: 'Turso'
        };
    } catch (error) {
        console.error('[DB] Failed to get database stats:', error.message);
        return { transactions: 0, providers: 0, dbType: 'Turso' };
    }
}

/**
 * Get total spending for a time period
 * @param {string} period - 'daily', 'weekly', or 'monthly'
 * @returns {number} Total spending in USD
 */
export async function getSpendingByPeriod(period = 'daily') {
    try {
        let since;
        const now = new Date();

        switch (period) {
            case 'daily':
                since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
                break;
            case 'weekly':
                const weekAgo = new Date(now);
                weekAgo.setDate(weekAgo.getDate() - 7);
                since = weekAgo.toISOString();
                break;
            case 'monthly':
                since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
                break;
            default:
                since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        }

        const result = await db.execute({
            sql: `SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total 
                  FROM transactions 
                  WHERE timestamp >= ? AND status = 'success'`,
            args: [since]
        });

        return parseFloat(result.rows[0]?.total || 0);
    } catch (error) {
        console.error('[DB] Failed to get spending by period:', error.message);
        return 0;
    }
}

/**
 * Get all spending limits status
 * @returns {Object} Current spending vs limits for all periods
 */
export async function getSpendingStatus() {
    try {
        const [daily, weekly, monthly] = await Promise.all([
            getSpendingByPeriod('daily'),
            getSpendingByPeriod('weekly'),
            getSpendingByPeriod('monthly')
        ]);

        return { daily, weekly, monthly };
    } catch (error) {
        console.error('[DB] Failed to get spending status:', error.message);
        return { daily: 0, weekly: 0, monthly: 0 };
    }
}

/**
 * Save Yellow Network session
 */
export async function saveYellowSession(session) {
    try {
        await db.execute({
            sql: `INSERT INTO yellow_sessions (session_id, participant_a, participant_b, status, allocations, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`,
            args: [
                session.app_session_id,
                session.participants?.[0] || null,
                session.participants?.[1] || null,
                session.status || 'open',
                JSON.stringify(session.allocations || []),
                session.created_at || new Date().toISOString()
            ]
        });
        console.log('[DB] Yellow Network session saved:', session.app_session_id);
        return true;
    } catch (error) {
        console.error('[DB] Failed to save Yellow Network session:', error.message);
        return false;
    }
}

/**
 * Save Yellow Network transaction
 */
export async function saveYellowTransaction(tx) {
    try {
        await db.execute({
            sql: `INSERT INTO yellow_transactions (session_id, from_address, to_address, asset, amount, tx_type, timestamp)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [
                tx.session_id,
                tx.from,
                tx.to,
                tx.asset,
                tx.amount,
                tx.tx_type || 'payment',
                tx.timestamp || new Date().toISOString()
            ]
        });
        console.log('[DB] Yellow Network transaction saved');
        return true;
    } catch (error) {
        console.error('[DB] Failed to save Yellow Network transaction:', error.message);
        return false;
    }
}

/**
 * Get Yellow Network session history
 */
export async function getYellowSessionHistory(limit = 50) {
    try {
        const result = await db.execute({
            sql: `SELECT * FROM yellow_sessions ORDER BY created_at DESC LIMIT ?`,
            args: [limit]
        });
        return result.rows.map(row => ({
            ...row,
            allocations: JSON.parse(row.allocations || '[]')
        }));
    } catch (error) {
        console.error('[DB] Failed to get Yellow Network session history:', error.message);
        return [];
    }
}

export default {
    saveTransaction,
    persistProviderStats,
    loadProviderStats,
    getTransactionHistory,
    getTransactionsByProvider,
    getDatabaseStats,
    getSpendingByPeriod,
    getSpendingStatus,
    saveYellowSession,
    saveYellowTransaction,
    getYellowSessionHistory
};
