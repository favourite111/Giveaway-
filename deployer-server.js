import express from 'express';
import botManager from './lib/botManager.js';
import instanceTracker from './lib/instanceTracker.js';

const app = express();
const DEPLOYER_PORT = 5000;
const BASE_BOT_PORT = 5001;
let portCounter = BASE_BOT_PORT;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== ROOT ENDPOINT ==========
app.get('/', (req, res) => {
    res.json({
        service: 'Gift-X Bot Deployer',
        version: '1.0.0',
        endpoints: {
            deploy: 'POST /deploy?phoneNumber=xxx&session=base64string',
            status_all: 'GET /status',
            status_one: 'GET /status/:phoneNumber',
            stop: 'POST /stop/:phoneNumber',
            stats: 'GET /stats'
        }
    });
});

// ========== DEPLOY ENDPOINT ==========
app.post('/deploy', async (req, res) => {
    try {
        const phoneNumber = req.query.phoneNumber || req.body.phoneNumber;
        const session = req.query.session || req.body.session;

        if (!phoneNumber || !session) {
            return res.status(400).json({
                error: 'Missing required parameters',
                required: ['phoneNumber', 'session'],
                example: 'POST /deploy?phoneNumber=234901234567&session=base64string'
            });
        }

        // Check if bot already exists
        if (instanceTracker.getInstance(phoneNumber)) {
            return res.status(409).json({
                error: 'Bot already deployed',
                phoneNumber
            });
        }

        // Check bot limit (max 10)
        const stats = instanceTracker.getStats();
        if (stats.currentInstances >= 10) {
            return res.status(429).json({
                error: 'Maximum bots limit reached',
                limit: 10,
                current: stats.currentInstances
            });
        }

        const port = portCounter++;
        const sessionHash = session.substring(0, 20) + '...'; // Hide full session

        // Create bot folder
        const botFolder = botManager.createBotFolder(phoneNumber, session, port);

        // Add instance to tracker BEFORE spawning
        instanceTracker.addInstance(phoneNumber, port, sessionHash);

        // Spawn bot process
        try {
            botManager.spawnBot(phoneNumber, botFolder, port);
            instanceTracker.updateInstanceStatus(phoneNumber, 'online');

            res.status(201).json({
                status: 'deployed',
                phoneNumber,
                port,
                botFolder,
                message: 'Bot deployed successfully and starting...',
                checkStatus: `GET /status/${phoneNumber}`
            });

            console.log(`✅ Bot deployed: ${phoneNumber} on port ${port}`);
        } catch (spawnError) {
            instanceTracker.updateInstanceStatus(phoneNumber, 'failed');
            throw spawnError;
        }

    } catch (error) {
        console.error('❌ Deploy error:', error);
        res.status(500).json({
            error: 'Failed to deploy bot',
            message: error.message
        });
    }
});

// ========== STATUS ENDPOINTS ==========
app.get('/status', (req, res) => {
    try {
        const stats = instanceTracker.getStats();
        res.json({
            totalDeployed: stats.totalDeployed,
            currentInstances: stats.currentInstances,
            onlineBots: stats.onlineBots,
            offlineBots: stats.offlineBots,
            bots: stats.instances.map(inst => ({
                phoneNumber: inst.phoneNumber,
                status: inst.status,
                uptime: inst.uptime,
                port: inst.port,
                createdAt: inst.createdAt
            }))
        });
    } catch (error) {
        console.error('❌ Status error:', error);
        res.status(500).json({
            error: 'Failed to fetch status',
            message: error.message
        });
    }
});

app.get('/status/:phoneNumber', (req, res) => {
    try {
        const { phoneNumber } = req.params;
        const instance = instanceTracker.getInstance(phoneNumber);

        if (!instance) {
            return res.status(404).json({
                error: 'Bot not found',
                phoneNumber
            });
        }

        res.json({
            phoneNumber: instance.phoneNumber,
            status: instance.status,
            uptime: instance.uptime,
            port: instance.port,
            createdAt: instance.createdAt,
            lastStatusUpdate: instance.lastStatusUpdate
        });
    } catch (error) {
        console.error('❌ Status error:', error);
        res.status(500).json({
            error: 'Failed to fetch status',
            message: error.message
        });
    }
});

// ========== STOP ENDPOINT ==========
app.post('/stop/:phoneNumber', (req, res) => {
    try {
        const { phoneNumber } = req.params;
        const instance = instanceTracker.getInstance(phoneNumber);

        if (!instance) {
            return res.status(404).json({
                error: 'Bot not found',
                phoneNumber
            });
        }

        // Kill bot process
        const killed = botManager.killBot(phoneNumber);

        if (!killed) {
            return res.status(500).json({
                error: 'Failed to stop bot',
                phoneNumber
            });
        }

        instanceTracker.updateInstanceStatus(phoneNumber, 'stopped');

        res.json({
            status: 'stopped',
            phoneNumber,
            message: 'Bot stopped successfully'
        });

        console.log(`✅ Bot stopped: ${phoneNumber}`);
    } catch (error) {
        console.error('❌ Stop error:', error);
        res.status(500).json({
            error: 'Failed to stop bot',
            message: error.message
        });
    }
});

// ========== STATS ENDPOINT ==========
app.get('/stats', (req, res) => {
    try {
        const stats = instanceTracker.getStats();
        res.json({
            deployment: {
                totalDeployed: stats.totalDeployed,
                currentInstances: stats.currentInstances
            },
            status: {
                online: stats.onlineBots,
                offline: stats.offlineBots
            },
            bots: stats.instances.length > 0 ? stats.instances : []
        });
    } catch (error) {
        console.error('❌ Stats error:', error);
        res.status(500).json({
            error: 'Failed to fetch stats',
            message: error.message
        });
    }
});

// ========== ERROR HANDLERS ==========
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.path,
        method: req.method,
        available: ['GET /', 'POST /deploy', 'GET /status', 'GET /status/:phoneNumber', 'POST /stop/:phoneNumber', 'GET /stats']
    });
});

app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: error.message
    });
});

// ========== START SERVER ==========
const server = app.listen(DEPLOYER_PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════╗
║   Gift-X Bot Deployer Running      ║
╚════════════════════════════════════╝

🚀 API Server: http://0.0.0.0:${DEPLOYER_PORT}
📊 Status Endpoint: GET /status
🚀 Deploy Endpoint: POST /deploy
⏹️  Stop Endpoint: POST /stop/:phoneNumber

Happy deploying! 🎉
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Shutting down deployer server...');
    server.close(() => {
        console.log('✅ Deployer server closed');
        process.exit(0);
    });
});

export default app;
