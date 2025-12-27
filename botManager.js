import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
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
        const envContent = `PHONE_NUMBER=${phoneNumber}
SESSION=${session}
BOT_PORT=${port}
NODE_ENV=production
`;

        fs.writeFileSync(path.join(botFolder, '.env'), envContent, 'utf8');
        console.log(`📝 Created .env for bot ${phoneNumber}`);

        return botFolder;
    } catch (error) {
        console.error(`❌ Error creating bot folder for ${phoneNumber}:`, error);
        throw error;
    }
}

function copyFiles(srcDir, destDir) {
    // Create bot folder
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        console.log(`📁 Created bot folder: ${destDir}`);
    }

    // Copy bot package.json from template
    const pkgSrc = path.join(srcDir, 'package.json');
    const pkgDest = path.join(destDir, 'package.json');
    if (!fs.existsSync(pkgSrc)) {
        throw new Error('Bot template package.json not found');
    }
    fs.copyFileSync(pkgSrc, pkgDest);

    // Copy bot entry file (index.js)
    const entrySrc = path.join(srcDir, 'index.js');
    const entryDest = path.join(destDir, 'index.js');
    if (!fs.existsSync(entrySrc)) {
        throw new Error('Bot template index.js not found');
    }
    fs.copyFileSync(entrySrc, entryDest);
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
                NODE_ENV: 'production'
            }
        });

        // Handle stdout
        botProcess.stdout?.on('data', (data) => {
            console.log(`[${phoneNumber}] ${data.toString().trim()}`);
        });

        // Handle stderr
        botProcess.stderr?.on('data', (data) => {
            console.error(`[${phoneNumber}] ERROR: ${data.toString().trim()}`);
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
