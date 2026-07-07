/**
 * deployer-server.js — Ultra-X Multi-Bot Deployer API
 * PostgreSQL-backed, Koyeb-ready.
 *
 * Required env vars:
 *   DATABASE_URL   — PostgreSQL connection string (Neon / Supabase / Render)
 *   API_KEY        — Secret key for all mutating endpoints
 *   PORT           — Assigned automatically by Koyeb (falls back to 5000)
 *   MAX_BOTS       — Optional, default 10
 */

import express       from 'express';
import dotenv        from 'dotenv';
import botManager    from './botManager.js';
import instanceTracker from './instanceTracker.js';
import { initDB }    from './db.js';

dotenv.config();

const app           = express();
const PORT          = process.env.PORT || 5000;
const BASE_BOT_PORT = 5001;
const MAX_BOTS      = parseInt(process.env.MAX_BOTS || '10', 10);
const API_KEY       = process.env.API_KEY || '';

let portCounter = BASE_BOT_PORT;

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * API Key guard — applied to all mutating endpoints (deploy / stop / remove).
 * GET endpoints (status, stats, health) are public.
 */
function requireApiKey(req, res, next) {
    if (!API_KEY) return next(); // No key configured — open (dev mode)
    const provided = req.headers['x-api-key'] || req.query.apiKey;
    if (provided !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized — invalid or missing API key' });
    }
    next();
}

// ─── Health Check (Koyeb pings this) ──────────────────────────────────────────

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ─── Root ──────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
    res.json({
        service:   'Ultra-X Bot Deployer',
        version:   '2.0.0',
        endpoints: {
            health:     'GET  /health',
            deploy:     'POST /deploy          [API key required]',
            status_all: 'GET  /status',
            status_one: 'GET  /status/:phoneNumber',
            stop:       'POST /stop/:phoneNumber   [API key required]',
            remove:     'POST /remove/:phoneNumber [API key required]',
            restart:    'POST /restart/:phoneNumber [API key required]',
            stats:      'GET  /stats'
        }
    });
});

// ─── Deploy ────────────────────────────────────────────────────────────────────

app.post('/deploy', requireApiKey, async (req, res) => {
    try {
        const phoneNumber = req.body.phoneNumber || req.query.phoneNumber;
        const session     = req.body.session     || req.query.session;

        if (!phoneNumber || !session) {
            return res.status(400).json({
                error:    'Missing required parameters',
                required: ['phoneNumber', 'session']
            });
        }

        // Validate session prefix
        const validPrefixes = ['Ultra-X:~', 'JUNE-MD:~', 'June-Ultra:~'];
        if (!validPrefixes.some(p => session.startsWith(p))) {
            return res.status(400).json({
                error:   'Invalid session format',
                hint:    `Session must start with one of: ${validPrefixes.join(', ')}`
            });
        }

        // Validate phone number (digits only, 7–15 chars)
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        if (cleanPhone.length < 7 || cleanPhone.length > 15) {
            return res.status(400).json({ error: 'Invalid phone number format' });
        }

        // Check duplicate
        if (await instanceTracker.getInstance(cleanPhone)) {
            return res.status(409).json({ error: 'Bot already deployed', phoneNumber: cleanPhone });
        }

        // Check bot limit
        const stats = await instanceTracker.getStats();
        if (stats.currentInstances >= MAX_BOTS) {
            return res.status(429).json({
                error:   'Maximum bot limit reached',
                limit:   MAX_BOTS,
                current: stats.currentInstances
            });
        }

        const port        = portCounter++;
        const sessionHash = session.substring(0, 20) + '...';

        const botFolder = botManager.createBotFolder(cleanPhone, session, port);
        await instanceTracker.addInstance(cleanPhone, port, sessionHash, session); // full session stored for crash-recovery

        try {
            botManager.spawnBot(cleanPhone, botFolder, port, { onAutoKill: onBotAutoKilled });
            await instanceTracker.updateInstanceStatus(cleanPhone, 'online');
        } catch (spawnErr) {
            await instanceTracker.updateInstanceStatus(cleanPhone, 'failed');
            throw spawnErr;
        }

        console.log(`✅ Bot deployed: ${cleanPhone} on port ${port}`);
        res.status(201).json({
            status:      'deployed',
            phoneNumber: cleanPhone,
            port,
            message:     'Bot deployed and starting...',
            checkStatus: `/status/${cleanPhone}`
        });

    } catch (err) {
        console.error('❌ Deploy error:', err);
        res.status(500).json({ error: 'Failed to deploy bot', message: err.message });
    }
});

// ─── Status ────────────────────────────────────────────────────────────────────

app.get('/status', async (req, res) => {
    try {
        const stats = await instanceTracker.getStats();
        res.json({
            totalDeployed:    stats.totalDeployed,
            currentInstances: stats.currentInstances,
            onlineBots:       stats.onlineBots,
            offlineBots:      stats.offlineBots,
            bots:             stats.instances
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch status', message: err.message });
    }
});

app.get('/status/:phoneNumber', async (req, res) => {
    try {
        const phoneNumber = req.params.phoneNumber.replace(/\D/g, '');
        const instance = await instanceTracker.getInstance(phoneNumber);
        if (!instance) {
            return res.status(404).json({ error: 'Bot not found', phoneNumber });
        }
        res.json(instance);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch status', message: err.message });
    }
});

// ─── Stop ──────────────────────────────────────────────────────────────────────

app.post('/stop/:phoneNumber', requireApiKey, async (req, res) => {
    try {
        const phoneNumber = req.params.phoneNumber.replace(/\D/g, '');
        const instance = await instanceTracker.getInstance(phoneNumber);
        if (!instance) {
            return res.status(404).json({ error: 'Bot not found', phoneNumber });
        }

        botManager.killBot(phoneNumber);
        await instanceTracker.updateInstanceStatus(phoneNumber, 'stopped');

        console.log(`🛑 Bot stopped: ${phoneNumber}`);
        res.json({ status: 'stopped', phoneNumber, message: 'Bot stopped successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to stop bot', message: err.message });
    }
});

// ─── Remove ────────────────────────────────────────────────────────────────────

app.post('/remove/:phoneNumber', requireApiKey, async (req, res) => {
    try {
        const phoneNumber = req.params.phoneNumber.replace(/\D/g, '');
        const instance = await instanceTracker.getInstance(phoneNumber);
        if (!instance) {
            return res.status(404).json({ error: 'Bot not found', phoneNumber });
        }

        botManager.deleteBot(phoneNumber);
        await instanceTracker.removeInstance(phoneNumber);

        console.log(`🗑️ Bot removed: ${phoneNumber}`);
        res.json({ status: 'removed', phoneNumber, message: 'Bot completely removed from server' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove bot', message: err.message });
    }
});

// ─── Restart ───────────────────────────────────────────────────────────────────

app.post('/restart/:phoneNumber', requireApiKey, async (req, res) => {
    try {
        const phoneNumber = req.params.phoneNumber.replace(/\D/g, '');
        const instance = await instanceTracker.getInstance(phoneNumber);
        if (!instance) {
            return res.status(404).json({ error: 'Bot not found', phoneNumber });
        }

        botManager.killBot(phoneNumber);
        await instanceTracker.updateInstanceStatus(phoneNumber, 'starting');

        // Use stored session for full re-deploy (handles ephemeral filesystem)
        if (instance.session) {
            const botFolder = botManager.createBotFolder(phoneNumber, instance.session, instance.port);
            botManager.spawnBot(phoneNumber, botFolder, instance.port, { onAutoKill: onBotAutoKilled });
        } else {
            // Fallback: try existing folder (may fail on ephemeral hosts)
            const botFolder = `${process.cwd()}/bots/bot_${phoneNumber}`;
            botManager.spawnBot(phoneNumber, botFolder, instance.port, { onAutoKill: onBotAutoKilled });
        }
        await instanceTracker.updateInstanceStatus(phoneNumber, 'online');

        console.log(`🔄 Bot restarted: ${phoneNumber}`);
        res.json({ status: 'restarted', phoneNumber, port: instance.port, message: 'Bot restarted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to restart bot', message: err.message });
    }
});

// ─── Stats ─────────────────────────────────────────────────────────────────────

app.get('/stats', async (req, res) => {
    try {
        const stats = await instanceTracker.getStats();
        res.json({
            deployment: {
                totalDeployed:    stats.totalDeployed,
                currentInstances: stats.currentInstances
            },
            status: {
                online:  stats.onlineBots,
                offline: stats.offlineBots
            },
            bots: stats.instances
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats', message: err.message });
    }
});

// ─── Auto-kill callback (called by botManager when 401 loop detected) ──────────

/**
 * Called by botManager when it auto-kills a bot due to a 401 loop.
 * Marks the bot as 'failed' in the DB so it isn't auto-recovered on next restart
 * (the session is dead — it needs a fresh one before it can come back).
 */
async function onBotAutoKilled(phoneNumber) {
    try {
        await instanceTracker.updateInstanceStatus(phoneNumber, 'failed');
        console.log(`📋 [${phoneNumber}] Status updated to 'failed' after 401 auto-kill`);
    } catch (err) {
        console.error(`❌ Failed to update status after auto-kill for ${phoneNumber}:`, err.message);
    }
}

// ─── 404 / Error handlers ──────────────────────────────────────────────────────

app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

app.use((err, req, res, _next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ─── Startup ───────────────────────────────────────────────────────────────────

async function start() {
    // 1. Connect DB + create tables
    await initDB();

    // 2. Restore portCounter from DB so restarts don't collide
    const maxPort = await instanceTracker.getMaxPort(BASE_BOT_PORT);
    portCounter = maxPort + 1;
    console.log(`🔢 Port counter restored to ${portCounter}`);

    // 3. Re-deploy bots that were online before the restart.
    //    Uses raw DB status (not live process status) so this works at startup
    //    before any bots are running. Also uses the stored full session to
    //    re-create the bot folder — needed on ephemeral filesystems (Render/Koyeb).
    const toRecover = await instanceTracker.getInstancesForRecovery();

    if (toRecover.length > 0) {
        console.log(`♻️  Recovering ${toRecover.length} bot(s) from last session...`);
        for (const inst of toRecover) {
            try {
                if (!inst.session) {
                    console.warn(`⚠️  No session stored for ${inst.phoneNumber} — skipping (redeploy manually)`);
                    await instanceTracker.updateInstanceStatus(inst.phoneNumber, 'offline');
                    continue;
                }
                // Full re-deploy: recreates bot folder + .env from stored session
                const botFolder = botManager.createBotFolder(inst.phoneNumber, inst.session, inst.port);
                botManager.spawnBot(inst.phoneNumber, botFolder, inst.port, { onAutoKill: onBotAutoKilled });
                await instanceTracker.updateInstanceStatus(inst.phoneNumber, 'online');
                console.log(`✅ Recovered: ${inst.phoneNumber} on port ${inst.port}`);
            } catch (err) {
                console.error(`❌ Failed to recover ${inst.phoneNumber}:`, err.message);
                await instanceTracker.updateInstanceStatus(inst.phoneNumber, 'offline');
            }
        }
    }

    // 4. Start server
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔════════════════════════════════════╗
║   Ultra-X Bot Deployer v2.0        ║
╚════════════════════════════════════╝
🚀 Running on port ${PORT}
🔒 API Key: ${API_KEY ? 'enabled' : 'disabled (set API_KEY to enable)'}
🤖 Max bots: ${MAX_BOTS}
        `);
    });
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Shutting down...');
    process.exit(0);
});

start().catch(err => {
    console.error('❌ Failed to start deployer:', err);
    process.exit(1);
});

export default app;
