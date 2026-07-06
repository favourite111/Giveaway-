import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import fsExtra from 'fs-extra';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 👇 BOT TEMPLATE (source code lives here)
// Resolve to absolute path for reliability
const TEMPLATE_DIR = path.resolve(__dirname, '../code');

// 👇 RUNNING BOTS DIRECTORY
const BOTS_DIR = path.resolve(__dirname, '../bots');

// Ensure bots directory exists
if (!fs.existsSync(BOTS_DIR)) {
    fs.mkdirSync(BOTS_DIR, { recursive: true });
    console.log('📁 Created bots directory');
}

// Store running processes
const runningProcesses = new Map();

/**
 * Create bot folder and .env file
 */
export function createBotFolder(phoneNumber, session, port) {
    try {
        const botFolder = path.join(BOTS_DIR, `bot_${phoneNumber}`);

        console.log(`🔍 Checking template path: ${TEMPLATE_DIR}`);
        if (!fs.existsSync(TEMPLATE_DIR)) {
            // Fallback for local development or different structures
            const fallbackTemplate = path.join(process.cwd(), 'code');
            if (fs.existsSync(fallbackTemplate)) {
                console.log(`📍 Using fallback template: ${fallbackTemplate}`);
                // Use fallback for this run
                copyFiles(fallbackTemplate, botFolder);
            } else {
                throw new Error(`Bot template directory not found at ${TEMPLATE_DIR}`);
            }
        } else {
            copyFiles(TEMPLATE_DIR, botFolder);
        }

        // Create .env file for this bot
        const envContent = `SESSION_ID=${session}
OWNER_NUMBER=${phoneNumber}
BOT_PORT=${port}
NODE_ENV=production
`;

  console.log('🧪 Writing .env with content:\n', envContent);
if (!envContent.includes('OWNER_NUMBER')) {
  throw new Error('OWNER_NUMBER missing in .env');
}
        if (!envContent.includes('SESSION_ID')) {
  throw new Error('SESSION_ID missing in .env');
}        
        fs.writeFileSync(path.join(botFolder, '.env'), envContent, 'utf8');
        console.log(`📝 Created .env for bot ${phoneNumber}`);

        return botFolder;
    } catch (error) {
        console.error(`❌ Error creating bot folder for ${phoneNumber}:`, error);
        throw error;
    }
}

function copyFiles(srcDir, destDir) {
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    // Copy bot template (NO node_modules)
    fsExtra.copySync(srcDir, destDir, {
        overwrite: true,
        filter: (src) => !src.includes('node_modules')
    });

    // 🔥 LINK ROOT node_modules
    const rootNodeModules = path.join(process.cwd(), 'node_modules');
const botNodeModules = path.join(destDir, 'node_modules');

if (!fs.existsSync(botNodeModules)) {
    fs.symlinkSync(rootNodeModules, botNodeModules, 'dir');
    console.log('🔗 Linked shared node_modules ->', rootNodeModules);
}
}

/**
 * Spawn a bot process
 */
export function spawnBot(phoneNumber, botFolder, port) {
    try {
        console.log(`🚀 Spawning bot for ${phoneNumber} on port ${port}...`);

        const indexPath = path.join(botFolder, 'index.js');

        // Check if index.js exists
        if (!fs.existsSync(indexPath)) {
            throw new Error(`index.js not found in ${botFolder}`);
        }

        // Spawn bot process
        const botProcess = spawn('node', [indexPath], {
            cwd: botFolder,
            stdio: 'pipe',
            detached: true,
            env: {
                ...process.env,
                PORT: port.toString(), // Override Render's PORT so bot doesn't collide with deployer
                NODE_ENV: 'production'
            }
        });

        // 401 logout loop detection
        let logoutCount = 0;
        const LOGOUT_KILL_THRESHOLD = 3;

        // Keywords that are worth logging — everything else is suppressed
        const IMPORTANT = [
            '[401]', 'logged out', 'disconnected', 'connected', 'online',
            'error', 'failed', 'fatal', 'session', 'syncing', 'synced',
            'starting', 'restarting', '[ cmd ]', 'sigterm', 'dashboard'
        ];

        function isImportant(line) {
            const lower = line.toLowerCase();
            return IMPORTANT.some(kw => lower.includes(kw));
        }

        // Buffer stdout into complete lines before logging (prevents chunk fragmentation)
        let stdoutBuffer = '';
        botProcess.stdout?.on('data', (data) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.split('\n');
            // Keep the last incomplete chunk in the buffer
            stdoutBuffer = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Only log lines that matter
                if (isImportant(trimmed)) {
                    console.log(`[${phoneNumber}] ${trimmed}`);
                }

                // 401 logout loop detection
                if (trimmed.includes('[401]') || trimmed.toLowerCase().includes('logged out')) {
                    logoutCount++;
                    if (logoutCount >= LOGOUT_KILL_THRESHOLD) {
                        console.warn(`🔐 [${phoneNumber}] 401 loop (${logoutCount}x) — auto-killing. Needs fresh session.`);
                        try { killBot(phoneNumber); } catch (_) {}
                    }
                } else if (trimmed.toLowerCase().includes('connected') || trimmed.toLowerCase().includes('online')) {
                    logoutCount = 0; // reset on successful connection
                }
            }
        });

        // Buffer stderr the same way
        let stderrBuffer = '';
        botProcess.stderr?.on('data', (data) => {
            stderrBuffer += data.toString();
            const lines = stderrBuffer.split('\n');
            stderrBuffer = lines.pop();
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) console.error(`[${phoneNumber}] ❌ ${trimmed}`);
            }
        });

        // Handle process exit
        botProcess.on('exit', (code) => {
            console.warn(`⚠️ Bot ${phoneNumber} exited with code ${code}`);
            runningProcesses.delete(phoneNumber);
        });

        // Handle errors
        botProcess.on('error', (error) => {
            console.error(`❌ Bot process error for ${phoneNumber}:`, error);
            runningProcesses.delete(phoneNumber);
        });

        // Store process reference
        runningProcesses.set(phoneNumber, {
            process: botProcess,
            pid: botProcess.pid,
            port,
            startTime: Date.now()
        });

        console.log(`✅ Bot spawned for ${phoneNumber} (PID: ${botProcess.pid})`);
        return botProcess;
    } catch (error) {
        console.error(`❌ Error spawning bot for ${phoneNumber}:`, error);
        throw error;
    }
}

/**
 * Kill a bot process
 */
export function killBot(phoneNumber) {
    try {
        const botData = runningProcesses.get(phoneNumber);
        
        if (!botData) {
            console.warn(`⚠️ Bot ${phoneNumber} not found in running processes`);
            return false;
        }

        const { pid } = botData;
        
        // Kill process group (includes all child processes)
        try {
            process.kill(-pid); // Negative PID kills process group
            console.log(`✅ Killed bot ${phoneNumber} (PID: ${pid})`);
        } catch (error) {
            // Try killing just the process
            botData.process.kill('SIGTERM');
            console.log(`✅ Terminated bot ${phoneNumber} (PID: ${pid})`);
        }

        runningProcesses.delete(phoneNumber);
        return true;
    } catch (error) {
        console.error(`❌ Error killing bot ${phoneNumber}:`, error);
        return false;
    }
}

/**
 * Get running process info
 */
export function getBotProcess(phoneNumber) {
    return runningProcesses.get(phoneNumber) || null;
}

/**
 * Get all running bots
 */
export function getAllRunningBots() {
    const bots = [];
    for (const [phoneNumber, data] of runningProcesses.entries()) {
        bots.push({
            phoneNumber,
            ...data
        });
    }
    return bots;
}

/**
 * Check if bot is running
 */
export function isBotRunning(phoneNumber) {
    const botData = runningProcesses.get(phoneNumber);
    if (!botData) return false;
    
    // Check if process is still alive
    try {
        process.kill(botData.pid, 0); // Signal 0 checks if process exists
        return true;
    } catch {
        runningProcesses.delete(phoneNumber);
        return false;
    }
}

/**
 * Get bot uptime
 */
export function getBotUptime(phoneNumber) {
    const botData = runningProcesses.get(phoneNumber);
    if (!botData) return 0;
    
    const uptimeMs = Date.now() - botData.startTime;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    
    return { hours, minutes, seconds: uptimeSeconds % 60, total: uptimeMs };
}

export default {
    createBotFolder,
    spawnBot,
    killBot,
    getBotProcess,
    getAllRunningBots,
    isBotRunning,
    getBotUptime
};
