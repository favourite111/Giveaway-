import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import botManager from './botManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTANCES_FILE = path.join(__dirname, '../instances.json');

/**
 * Load instances from file
 */
function loadInstances() {
    try {
        if (!fs.existsSync(INSTANCES_FILE)) {
            return { instances: [], totalDeployed: 0, createdAt: new Date().toISOString() };
        }
        return JSON.parse(fs.readFileSync(INSTANCES_FILE, 'utf8'));
    } catch (error) {
        console.error('❌ Error loading instances:', error);
        return { instances: [], totalDeployed: 0, createdAt: new Date().toISOString() };
    }
}

/**
 * Save instances to file
 */
function saveInstances(data) {
    try {
        fs.writeFileSync(INSTANCES_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('❌ Error saving instances:', error);
        return false;
    }
}

/**
 * Add new instance
 */
export function addInstance(phoneNumber, port, sessionHash) {
    try {
        const data = loadInstances();
        
        // Check if already exists
        if (data.instances.some(inst => inst.phoneNumber === phoneNumber)) {
            throw new Error(`Bot ${phoneNumber} already exists`);
        }

        const instance = {
            phoneNumber,
            port,
            sessionHash,
            status: 'starting',
            createdAt: new Date().toISOString(),
            uptime: 0
        };

        data.instances.push(instance);
        data.totalDeployed += 1;
        
        saveInstances(data);
        console.log(`✅ Instance added: ${phoneNumber}`);
        return instance;
    } catch (error) {
        console.error(`❌ Error adding instance:`, error);
        throw error;
    }
}

/**
 * Update instance status
 */
export function updateInstanceStatus(phoneNumber, status) {
    try {
        const data = loadInstances();
        const instance = data.instances.find(inst => inst.phoneNumber === phoneNumber);
        
        if (!instance) {
            throw new Error(`Bot ${phoneNumber} not found`);
        }

        instance.status = status;
        instance.lastStatusUpdate = new Date().toISOString();
        
        saveInstances(data);
        return instance;
    } catch (error) {
        console.error(`❌ Error updating status:`, error);
        throw error;
    }
}

/**
 * Get instance by phone number
 */
export function getInstance(phoneNumber) {
    const data = loadInstances();
    const instance = data.instances.find(inst => inst.phoneNumber === phoneNumber);
    
    if (!instance) return null;

    // Get real-time status
    const isRunning = botManager.isBotRunning(phoneNumber);
    instance.status = isRunning ? 'online' : 'offline';
    
    if (isRunning) {
        const uptime = botManager.getBotUptime(phoneNumber);
        instance.uptime = `${uptime.hours}h ${uptime.minutes}m`;
    } else {
        instance.uptime = '0m';
    }

    return instance;
}

/**
 * Get all instances
 */
export function getAllInstances() {
    const data = loadInstances();
    
    return data.instances.map(instance => {
        const isRunning = botManager.isBotRunning(instance.phoneNumber);
        instance.status = isRunning ? 'online' : 'offline';
        
        if (isRunning) {
            const uptime = botManager.getBotUptime(instance.phoneNumber);
            instance.uptime = `${uptime.hours}h ${uptime.minutes}m`;
        } else {
            instance.uptime = '0m';
        }
        
        return instance;
    });
}

/**
 * Remove instance
 */
export function removeInstance(phoneNumber) {
    try {
        const data = loadInstances();
        const index = data.instances.findIndex(inst => inst.phoneNumber === phoneNumber);
        
        if (index === -1) {
            throw new Error(`Bot ${phoneNumber} not found`);
        }

        data.instances.splice(index, 1);
        saveInstances(data);
        console.log(`✅ Instance removed: ${phoneNumber}`);
        return true;
    } catch (error) {
        console.error(`❌ Error removing instance:`, error);
        throw error;
    }
}

/**
 * Get deployment stats
 */
export function getStats() {
    const data = loadInstances();
    const instances = getAllInstances();
    const onlineBots = instances.filter(inst => inst.status === 'online').length;

    return {
        totalDeployed: data.totalDeployed,
        currentInstances: instances.length,
        onlineBots,
        offlineBots: instances.length - onlineBots,
        instances
    };
}

export default {
    loadInstances,
    saveInstances,
    addInstance,
    updateInstanceStatus,
    getInstance,
    getAllInstances,
    removeInstance,
    getStats
};
