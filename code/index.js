import module from 'module';

console.log('🧭 Module search paths:');
console.log(module.createRequire(import.meta.url).resolve.paths('chokidar'));




import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎯 CONFIGURATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CONFIG = {
  GITHUB_REPO: 'https://github.com/favourite111/X/archive/refs/heads/main.zip',
  FOLDER_DEPTH: 10,
  FOLDER_PREFIX: '.x',
  DECOY_DEPTH: 50,
  NODE_FLAGS: [
    '--expose-gc',
    '--max-old-space-size=280',
    '--optimize-for-size',
    '--gc-interval=100'
  ]
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📁 PATHS SETUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Generate nested folder structure (.x1/.x2/.x3/...)
const folderStructure = Array.from(
  { length: CONFIG.FOLDER_DEPTH }, 
  (_, i) => `${CONFIG.FOLDER_PREFIX}${i + 1}`
);

// Base path (fake node_modules structure)
const BASE_PATH = path.join(
  __dirname, 
 // 'node_modules', 
 // '@adiwajshing', 
  //'keyed-db', 
  'lib'
);

// Hidden bot path
const HIDE_PATH = path.join(BASE_PATH, ...folderStructure);
const EXTRACT_DIR = path.join(HIDE_PATH, 'X-main');

// Environment file paths
const LOCAL_ENV = path.join(__dirname, '.env');
const EXTRACTED_ENV = path.join(EXTRACT_DIR, '.env');

// Data backup paths
const DATA_BACKUP_DIR = path.join(__dirname, '.data_backup');
const DATA_DIR = path.join(EXTRACT_DIR, 'data');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔧 GLOBALS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let botProcess = null;
let isRestarting = false;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎭 DECOY FOLDERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BASE = path.join(__dirname, '.npm', 'xcache');

function createDecoyFolders() {
  let base = BASE;

  // Ensure base exists
  fs.mkdirSync(base, { recursive: true });

  for (let i = 1; i <= CONFIG.DECOY_DEPTH; i++) {
    base = path.join(base, `.x${i}`);
    fs.mkdirSync(base, { recursive: true });
  }

  // Final folder
  const finalPath = path.join(
 base,'x-main','repent🗿', 'dont💀','steal☠️','my🔥','code😎','now go','and ask','forgive-ness','fool☠️');

  fs.mkdirSync(finalPath, { recursive: true });
}
//hhgggghhhhhhhfs watch//

function watchDecoyFolders() {
  const watcher = chokidar.watch(BASE, {
    persistent: true,
    ignoreInitial: true,
    depth: CONFIG.DECOY_DEPTH + 10
  });

  watcher.on('unlinkDir', (dirPath) => {
    console.log(chalk.red(`[GIFT-X] ❌ Folder deleted`));
    console.log(chalk.yellow('[WATCHER] 🔄 Restoring decoy structure...'));
    createDecoyFolders();
  });

  watcher.on('change', (filePath) => {
    console.log(chalk.magenta(`[GIFT-X] ✏️ Edited`));
  });

  watcher.on('error', (err) => {
    console.log(chalk.red('[WATCHER] Error:'), err);
  });
}
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📂 FILE OPERATIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⬇️  DOWNLOAD & SETUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function downloadAndExtract() {
  try {
    console.log(chalk.magenta('━'.repeat(43)));
    console.log(chalk.cyan.bold('🚀 GIFT-X LAUNCHER'));
   console.log(chalk.magenta('━'.repeat(43)));

    // Backup existing data
    if (fs.existsSync(DATA_DIR)) {
      console.log(chalk.blue('[GIFT-X] 💾 Backing up data/ folder...'));
      
      if (fs.existsSync(DATA_BACKUP_DIR)) {
        fs.rmSync(DATA_BACKUP_DIR, { recursive: true, force: true });
      }
      
      copyDirSync(DATA_DIR, DATA_BACKUP_DIR);
      
      const itemCount = fs.readdirSync(DATA_BACKUP_DIR).length;
      console.log(chalk.green(`   ✓ Backed up data/ (${itemCount} items)`));
    }

    // Clean old code
    if (fs.existsSync(HIDE_PATH)) {
      console.log(chalk.yellow('[GIFT-X] 🗑️  Removing old code...'));
      fs.rmSync(HIDE_PATH, { recursive: true, force: true });
      console.log(chalk.green('   ✓ Old code removed'));
    }

    // Create directory structure
    fs.mkdirSync(HIDE_PATH, { recursive: true });

    // Download from GitHub
    const zipPath = path.join(HIDE_PATH, 'repo.zip');
    console.log(chalk.blue('[GIFT-X] ⬇️  Downloading latest code from GitHub...'));

    const response = await axios({
      url: CONFIG.GITHUB_REPO,
      method: 'GET',
      responseType: 'stream',
      timeout: 60000
    });

    let downloadedSize = 0;
    response.data.on('data', (chunk) => {
      downloadedSize += chunk.length;
      process.stdout.write(`\r   📦 Downloaded: ${(downloadedSize / 1024 / 1024).toFixed(2)} MB`);
    });

    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(zipPath);
      response.data.pipe(writer);
      writer.on('finish', () => {
        console.log('');
        console.log(chalk.green('   ✓ Download complete'));
        resolve();
      });
      writer.on('error', reject);
    });

    // Extract ZIP
    console.log(chalk.blue('[GIFT-X] 📦 Extracting files...'));
    try {
      new AdmZip(zipPath).extractAllTo(HIDE_PATH, true);
      console.log(chalk.green('   ✓ Files extracted'));
    } catch (error) {
      console.error(chalk.red('   ❌ Failed to extract ZIP:'), error.message);
      throw error;
    } finally {
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
    }

    // Restore backed up data
    if (fs.existsSync(DATA_BACKUP_DIR)) {
      console.log(chalk.blue('[GIFT-X] ♻️  Restoring data/ folder...'));
      
      if (fs.existsSync(DATA_DIR)) {
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
      }
      
      copyDirSync(DATA_BACKUP_DIR, DATA_DIR);
      
      const itemCount = fs.readdirSync(DATA_DIR).length;
      console.log(chalk.green(`   ✓ Restored data/ (${itemCount} items)`));
      
      fs.rmSync(DATA_BACKUP_DIR, { recursive: true, force: true });
    }

    console.log(chalk.green.bold('\n[GIFT-X] ✅ Setup complete!\n'));

  } catch (error) {
    console.error(chalk.red('\n❌ Download/Extract failed:'), error.message);
    throw error;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔐 ENVIRONMENT SETUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function applyLocalEnv() {
  if (!fs.existsSync(LOCAL_ENV)) {
    console.log(chalk.yellow('⚠️  No local .env found (using default)'));
    return;
  }

  try {
    fs.mkdirSync(EXTRACT_DIR, { recursive: true });
    fs.copyFileSync(LOCAL_ENV, EXTRACTED_ENV);
    console.log(chalk.green('[GIFT-X] 🔐 Local .env applied'));
  } catch (error) {
    console.error(chalk.red('❌ Failed to apply local .env:'), error.message);
  }

  await delay(500);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔄 BOT RESTART
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function restartBot() {
  if (isRestarting) return;
  isRestarting = true;

  console.log(chalk.yellow('\n🔄 Restarting bot due to .env changes...\n'));

  if (botProcess) {
    botProcess.kill('SIGTERM');
    await delay(2000);
  }

  await applyLocalEnv();
  startBot();

  isRestarting = false;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 👀 ENVIRONMENT WATCHER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function watchEnvFile() {
  if (!fs.existsSync(LOCAL_ENV)) {
    console.log(chalk.yellow('⚠️  .env file not found, watcher disabled'));
    return;
  }

  console.log(chalk.cyan('[GIFT-X] 👀 Watching .env for changes...\n'));

  let debounceTimer = null;

  fs.watch(LOCAL_ENV, (eventType) => {
    if (eventType === 'change') {
      clearTimeout(debounceTimer);
      
      debounceTimer = setTimeout(() => {
        console.log(chalk.bgYellow.black('\n' + '━'.repeat(43)));
        console.log(chalk.yellow('📝 .env file change detected!'));
        console.log(chalk.bgYellow.black('━'.repeat(43) + '\n'));
        restartBot();
      }, 1000);
    }
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🚀 BOT STARTER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function startBot() {
  console.log(chalk.magenta('━'.repeat(43)));
  console.log(chalk.cyan.bold('🤖 STARTING GIFT-X....')); console.log(chalk.magenta('━'.repeat(43)));
  console.log('');

  if (!fs.existsSync(EXTRACT_DIR)) {
    console.error(chalk.red('❌ Extracted directory not found. Cannot start bot.'));
    return;
  }

  const indexPath = path.join(EXTRACT_DIR, 'index.js');
  if (!fs.existsSync(indexPath)) {
    console.error(chalk.red('❌ index.js not found in extracted directory.'));
    return;
  }

  botProcess = spawn('node', [...CONFIG.NODE_FLAGS, 'index.js'], {
    cwd: EXTRACT_DIR,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' }
  });

  botProcess.on('close', (code) => {
    if (!isRestarting) {
      console.log(chalk.red(`\n[GIFT-X] Bot exited with code: ${code} 💔\n`));
      process.exit(code);
    }
  });

  botProcess.on('error', (error) => {
    console.error(chalk.red('❌ Bot failed to start:'), error.message);
    if (!isRestarting) {
      process.exit(1);
    }
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎯 MAIN EXECUTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

(async () => {
  try {
    createDecoyFolders();
    await downloadAndExtract();
    await applyLocalEnv();
    startBot();
    watchEnvFile();
    watchDecoyFolders()
  } catch (error) {
    console.error(chalk.red('\n❌ Fatal error in launcher:'), error.message);
    console.log(chalk.yellow('\n💡 Tip: Check your internet connection and try again\n'));
    process.exit(1);
  }
})();
