/**
 * instanceTracker.js — PostgreSQL-backed bot instance tracker
 * Drop-in replacement for the old JSON-file version.
 * All functions are now async.
 */

import pool from './db.js';
import botManager from './botManager.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Get real-time status by combining DB record with live process info.
 */
function enrichWithLiveStatus(row) {
    if (!row) return null;
    const isRunning = botManager.isBotRunning(row.phone_number);
    const uptime    = isRunning ? botManager.getBotUptime(row.phone_number) : null;

    return {
        phoneNumber:      row.phone_number,
        port:             row.port,
        sessionHash:      row.session_hash,
        status:           isRunning ? 'online' : 'offline',
        uptime:           isRunning && uptime ? `${uptime.hours}h ${uptime.minutes}m` : '0m',
        createdAt:        row.created_at,
        lastStatusUpdate: row.last_status_update
    };
}

// ─── Exported API ──────────────────────────────────────────────────────────────

/**
 * Add a new bot instance.
 */
export async function addInstance(phoneNumber, port, sessionHash) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `INSERT INTO instances (phone_number, port, session_hash, status)
             VALUES ($1, $2, $3, 'starting')`,
            [phoneNumber, port, sessionHash]
        );

        // Increment total_deployed counter
        await client.query(
            `UPDATE deployer_meta SET value = (value::int + 1) WHERE key = 'total_deployed'`
        );

        await client.query('COMMIT');
        console.log(`✅ Instance added: ${phoneNumber}`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error adding instance:', err);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Update a bot's status field in the DB.
 */
export async function updateInstanceStatus(phoneNumber, status) {
    await pool.query(
        `UPDATE instances
         SET status = $1, last_status_update = NOW()
         WHERE phone_number = $2`,
        [status, phoneNumber]
    );
}

/**
 * Get a single instance (with live process status).
 * Returns null if not found.
 */
export async function getInstance(phoneNumber) {
    const { rows } = await pool.query(
        `SELECT * FROM instances WHERE phone_number = $1`,
        [phoneNumber]
    );
    return rows[0] ? enrichWithLiveStatus(rows[0]) : null;
}

/**
 * Get all instances (with live process status).
 */
export async function getAllInstances() {
    const { rows } = await pool.query(
        `SELECT * FROM instances ORDER BY created_at ASC`
    );
    return rows.map(enrichWithLiveStatus);
}

/**
 * Remove an instance record from the DB entirely.
 */
export async function removeInstance(phoneNumber) {
    const { rowCount } = await pool.query(
        `DELETE FROM instances WHERE phone_number = $1`,
        [phoneNumber]
    );
    if (rowCount === 0) throw new Error(`Bot ${phoneNumber} not found`);
    console.log(`✅ Instance removed: ${phoneNumber}`);
}

/**
 * Get aggregated deployment stats.
 */
export async function getStats() {
    const [{ rows: metaRows }, allInstances] = await Promise.all([
        pool.query(`SELECT value FROM deployer_meta WHERE key = 'total_deployed'`),
        getAllInstances()
    ]);

    const totalDeployed  = parseInt(metaRows[0]?.value ?? '0', 10);
    const onlineBots     = allInstances.filter(i => i.status === 'online').length;

    return {
        totalDeployed,
        currentInstances: allInstances.length,
        onlineBots,
        offlineBots:      allInstances.length - onlineBots,
        instances:        allInstances
    };
}

/**
 * Get the highest port currently in use (for restoring portCounter on restart).
 * Returns BASE_BOT_PORT - 1 if no instances exist.
 */
export async function getMaxPort(baseBotPort) {
    const { rows } = await pool.query(`SELECT MAX(port) AS max_port FROM instances`);
    return rows[0]?.max_port ?? (baseBotPort - 1);
}

export default {
    addInstance,
    updateInstanceStatus,
    getInstance,
    getAllInstances,
    removeInstance,
    getStats,
    getMaxPort
};
