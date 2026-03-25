#!/usr/bin/env node

/**
 * QilinClaw CLI
 * 
 * Usage:
 *   qilinclaw install          Install dependencies and build project
 *   qilinclaw uninstall        Clean up and remove startup task
 *   qilinclaw gateway          Start gateway WebUI (auto-opens browser)
 *   qilinclaw gateway --no-browser   Start gateway without opening browser
 *   qilinclaw doctor           Check dependencies and environment
 */

const { execSync, spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 18168;
const TASK_NAME = 'QilinClaw';
const URL = `http://127.0.0.1:${PORT}/`;

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

function banner() {
    console.log(`
${YELLOW}${BOLD}  🐉 QilinClaw${RESET}
${DIM}  AI Assistant Platform${RESET}
`);
}

function log(msg) { console.log(`  ${GREEN}✔${RESET} ${msg}`); }
function warn(msg) { console.log(`  ${YELLOW}⚠${RESET} ${msg}`); }
function fail(msg) { console.log(`  ${RED}✖${RESET} ${msg}`); }
function info(msg) { console.log(`  ${CYAN}ℹ${RESET} ${msg}`); }

// ─── open browser (cross-platform) ──────────────────
function openBrowser(url) {
    const platform = os.platform();
    let cmd;
    if (platform === 'win32') {
        cmd = `start "" "${url}"`;
    } else if (platform === 'darwin') {
        cmd = `open "${url}"`;
    } else {
        cmd = `xdg-open "${url}"`;
    }
    exec(cmd, (err) => {
        if (err) {
            warn(`Could not open browser automatically. Please visit: ${url}`);
        }
    });
}

// ─── wait for server ready, then open browser ───────
function waitForServerAndOpenBrowser(url, maxAttempts = 30) {
    let attempts = 0;
    const interval = setInterval(() => {
        attempts++;
        const req = http.get(url, (res) => {
            clearInterval(interval);
            log(`Server ready! Opening browser...`);
            openBrowser(url);
        });
        req.on('error', () => {
            // Server not ready yet
            if (attempts >= maxAttempts) {
                clearInterval(interval);
                warn(`Server did not respond after ${maxAttempts}s. Please open manually: ${url}`);
            }
        });
        req.setTimeout(800, () => req.destroy());
    }, 1000);
}

// ─── startup task (Windows schtasks) ─────────────────
function installStartupTask() {
    if (os.platform() !== 'win32') {
        info('Auto-start on boot is only supported on Windows for now.');
        return;
    }

    const nodePath = process.execPath;
    const scriptPath = path.join(ROOT, 'bin', 'qilinclaw.js');
    // Use --no-browser for startup since user may not want a browser pop-up on every login
    // They can change this behavior later
    const command = `"${nodePath}" "${scriptPath}" gateway`;

    try {
        // Remove existing task first (ignore errors if it doesn't exist)
        try {
            execSync(`schtasks /delete /tn "${TASK_NAME}" /f`, { stdio: 'pipe' });
        } catch (e) { /* task doesn't exist, that's fine */ }

        execSync(
            `schtasks /create /tn "${TASK_NAME}" /tr "${command}" /sc onlogon /rl limited /f`,
            { stdio: 'pipe' }
        );
        log(`Startup task registered: QilinClaw will auto-start on login`);
    } catch (e) {
        warn(`Could not register startup task: ${e.message}`);
        info('You can manually add QilinClaw to startup if needed.');
    }
}

function removeStartupTask() {
    if (os.platform() !== 'win32') return;

    try {
        execSync(`schtasks /delete /tn "${TASK_NAME}" /f`, { stdio: 'pipe' });
        log('Startup task removed');
    } catch (e) {
        // Task may not exist, that's ok
        info('No startup task found (already removed or never created)');
    }
}

// ─── install ─────────────────────────────────────────
function cmdInstall() {
    banner();
    info('Installing dependencies...');
    try {
        execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
        log('Dependencies installed');
    } catch (e) {
        fail('Failed to install dependencies');
        process.exit(1);
    }

    info('Building project...');
    try {
        execSync('npm run build -w @qilin-claw/server', { cwd: ROOT, stdio: 'inherit' });
        execSync('npm run build -w @qilin-claw/client', { cwd: ROOT, stdio: 'inherit' });
        log('Build complete');
    } catch (e) {
        fail('Build failed');
        process.exit(1);
    }

    // Register startup task
    info('Registering startup task...');
    installStartupTask();

    log('Installation complete! Run: qilinclaw gateway');
}

// ─── uninstall ───────────────────────────────────────
function cmdUninstall() {
    banner();
    info('Cleaning up...');

    // Remove startup task first
    removeStartupTask();

    const targets = [
        'node_modules',
        'packages/server/dist',
        'packages/server/node_modules',
        'packages/client/dist',
        'packages/client/node_modules',
    ];

    for (const t of targets) {
        const p = path.join(ROOT, t);
        if (fs.existsSync(p)) {
            fs.rmSync(p, { recursive: true, force: true });
            log(`Removed ${t}`);
        }
    }

    log('Uninstall complete');
}

// ─── gateway ─────────────────────────────────────────
function cmdGateway() {
    banner();

    const noBrowser = process.argv.includes('--no-browser');

    // Check if server is built
    const serverDist = path.join(ROOT, 'packages', 'server', 'dist', 'index.js');
    if (!fs.existsSync(serverDist)) {
        warn('Server not built yet, building now...');
        try {
            execSync('npm run build -w @qilin-claw/server', { cwd: ROOT, stdio: 'inherit' });
            execSync('npm run build -w @qilin-claw/client', { cwd: ROOT, stdio: 'inherit' });
        } catch (e) {
            fail('Build failed. Run "qilinclaw doctor" to check your environment.');
            process.exit(1);
        }
    }

    console.log(`  ${GREEN}${BOLD}🐉 QilinClaw Gateway starting...${RESET}`);
    console.log(`  ${CYAN}➜${RESET}  WebUI: ${BOLD}${URL}${RESET}`);
    console.log(`  ${DIM}  Press Ctrl+C to stop${RESET}\n`);

    const child = spawn(process.execPath, [serverDist], {
        cwd: path.join(ROOT, 'packages', 'server'),
        stdio: 'inherit',
        env: { ...process.env, PORT: String(PORT) },
    });

    // Auto-open browser after server is ready
    if (!noBrowser) {
        waitForServerAndOpenBrowser(URL);
    }

    child.on('error', (err) => {
        fail(`Failed to start gateway: ${err.message}`);
        process.exit(1);
    });

    child.on('exit', (code) => {
        if (code !== 0) {
            fail(`Gateway exited with code ${code}`);
        }
        process.exit(code || 0);
    });

    // Forward termination signals
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
}

// ─── doctor ──────────────────────────────────────────
function cmdDoctor() {
    banner();
    info('Checking environment...\n');
    let allGood = true;

    // Node.js
    try {
        const nodeVer = process.version;
        const major = parseInt(nodeVer.slice(1));
        if (major >= 20) {
            log(`Node.js ${nodeVer} ${DIM}(recommended)${RESET}`);
        } else if (major >= 18) {
            warn(`Node.js ${nodeVer} ${DIM}(works, but v20 LTS recommended)${RESET}`);
        } else {
            fail(`Node.js ${nodeVer} ${DIM}(too old, need >= 18)${RESET}`);
            allGood = false;
        }
    } catch {
        fail('Node.js not found');
        allGood = false;
    }

    // npm
    try {
        const npmVer = execSync('npm --version', { encoding: 'utf-8' }).trim();
        log(`npm ${npmVer}`);
    } catch {
        fail('npm not found');
        allGood = false;
    }

    // Git
    try {
        const gitVer = execSync('git --version', { encoding: 'utf-8' }).trim();
        log(gitVer);
    } catch {
        warn('Git not found (only needed for cloning)');
    }

    // Python (optional)
    try {
        const pyVer = execSync('python --version 2>&1', { encoding: 'utf-8' }).trim();
        log(`${pyVer} ${DIM}(for local embedding models)${RESET}`);
    } catch {
        try {
            const pyVer = execSync('python3 --version 2>&1', { encoding: 'utf-8' }).trim();
            log(`${pyVer} ${DIM}(for local embedding models)${RESET}`);
        } catch {
            warn('Python not found (optional, for local embedding models)');
        }
    }

    // Dependencies installed?
    const nodeModules = path.join(ROOT, 'node_modules');
    if (fs.existsSync(nodeModules)) {
        log('Dependencies installed');
    } else {
        fail('Dependencies not installed — run: qilinclaw install');
        allGood = false;
    }

    // Server built?
    const serverDist = path.join(ROOT, 'packages', 'server', 'dist', 'index.js');
    if (fs.existsSync(serverDist)) {
        log('Server built');
    } else {
        fail('Server not built — run: qilinclaw install');
        allGood = false;
    }

    // Client built?
    const clientDist = path.join(ROOT, 'packages', 'client', 'dist', 'index.html');
    if (fs.existsSync(clientDist)) {
        log('Client built');
    } else {
        fail('Client not built — run: qilinclaw install');
        allGood = false;
    }

    // Startup task?
    if (os.platform() === 'win32') {
        try {
            execSync(`schtasks /query /tn "${TASK_NAME}"`, { stdio: 'pipe' });
            log('Startup task registered (auto-start on login)');
        } catch {
            warn('Startup task not registered — will be created on next install');
        }
    }

    // Port check
    try {
        const net = require('net');
        const server = net.createServer();
        server.once('error', () => {
            warn(`Port ${PORT} is in use`);
        });
        server.once('listening', () => {
            server.close();
            log(`Port ${PORT} available`);
        });
        server.listen(PORT);
    } catch { }

    console.log('');
    if (allGood) {
        log(`${GREEN}${BOLD}All checks passed!${RESET} Run: qilinclaw gateway`);
    } else {
        fail(`${RED}Some checks failed.${RESET} Fix the issues above and try again.`);
    }
}

// ─── main ────────────────────────────────────────────
const cmd = process.argv[2];

const commands = {
    install: cmdInstall,
    uninstall: cmdUninstall,
    gateway: cmdGateway,
    doctor: cmdDoctor,
};

if (!cmd || !commands[cmd]) {
    banner();
    console.log(`  ${BOLD}Usage:${RESET}  qilinclaw <command>\n`);
    console.log(`  ${BOLD}Commands:${RESET}`);
    console.log(`    ${CYAN}install${RESET}      Install dependencies and build project`);
    console.log(`    ${CYAN}uninstall${RESET}    Clean up and remove startup task`);
    console.log(`    ${CYAN}gateway${RESET}      Start gateway WebUI (auto-opens browser)`);
    console.log(`    ${CYAN}doctor${RESET}       Check environment and dependencies`);
    console.log('');
    console.log(`  ${BOLD}Flags:${RESET}`);
    console.log(`    ${CYAN}--no-browser${RESET}  Skip auto-opening browser (for gateway)`);
    console.log('');
    process.exit(cmd ? 1 : 0);
} else {
    commands[cmd]();
}
