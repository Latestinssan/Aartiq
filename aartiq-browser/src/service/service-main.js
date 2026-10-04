/**
 * Aartiq Background Service
 * 
 * This service runs in the background even when the browser is closed.
 * It executes scheduled tasks like PDF generation, web scraping, and AI prompts.
 * 
 * Key Features:
 * - Runs as system service (Windows Task Scheduler / macOS LaunchDaemon)
 * - System tray icon only
 * - Executes scheduled tasks on time
 * - Sends notifications to desktop and mobile
 * - Handles system sleep/wake events
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, powerMonitor, Notification } = require('electron');
const path = require('path');
const os = require('os');

// Import service modules
const { TrayManager } = require('./tray-manager');
const { TaskScheduler } = require('./scheduler');
const { TaskQueue } = require('./task-queue');
const { StorageManager } = require('./storage');
const { ModelSelector } = require('./model-selector');
const { NotificationManager } = require('./notifications');
const { MobileNotifier } = require('./mobile-notifier');
const { SleepHandler } = require('./sleep-handler');
const { IPCHandler } = require('./ipc-service');
const { resolveServiceHost } = require('./service-bind');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    console.log('[Service] Another instance is already running. Exiting.');
    app.quit();
}

// Service configuration
const SERVICE_CONFIG = {
    name: 'Aartiq Service',
    version: '1.0.0',
    storagePath: path.join(app.getPath('documents'), 'Aartiq'),
    publicPath: path.join(app.getPath('documents'), 'Aartiq', 'public'),
    port: 3999, // For serving files to mobile
};

// Global state
let trayManager = null;
let taskScheduler = null;
let taskQueue = null;
let storageManager = null;
let modelSelector = null;
let notificationManager = null;
let mobileNotifier = null;
let sleepHandler = null;
let ipcHandler = null;
let httpServer = null;
let isQuitting = false;

// Logging utility
function log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`, ...args);
}

// Initialize all service components
async function initializeService() {
    log('INFO', 'Initializing Aartiq Background Service...');
    log('INFO', `Platform: ${process.platform}`);
    log('INFO', `User: ${os.userInfo().username}`);
    log('INFO', `Storage Path: ${SERVICE_CONFIG.storagePath}`);

    try {
        // Initialize storage first
        storageManager = new StorageManager(SERVICE_CONFIG.storagePath);
        await storageManager.initialize();
        log('INFO', 'Storage initialized');

        // Initialize model selector
        modelSelector = new ModelSelector(storageManager);
        await modelSelector.initialize();
        log('INFO', 'Model selector initialized');

        // Initialize notification manager
        notificationManager = new NotificationManager();
        notificationManager.initialize();
        log('INFO', 'Notification manager initialized');

        // Initialize mobile notifier
        mobileNotifier = new MobileNotifier();
        await mobileNotifier.initialize();
        log('INFO', 'Mobile notifier initialized');

        // Initialize task queue
        taskQueue = new TaskQueue(storageManager);
        await taskQueue.initialize();
        log('INFO', 'Task queue initialized');

        // Initialize task scheduler
        taskScheduler = new TaskScheduler(taskQueue, storageManager);
        taskScheduler.on('task:due', handleTaskDue);
        taskScheduler.on('task:missed', handleTaskMissed);
        await taskScheduler.initialize();
        log('INFO', 'Task scheduler initialized');

        // Initialize sleep handler
        sleepHandler = new SleepHandler(taskScheduler);
        sleepHandler.initialize();
        log('INFO', 'Sleep handler initialized');

        // Initialize IPC handler for browser communication
        ipcHandler = new IPCHandler(taskScheduler, taskQueue, storageManager, mobileNotifier);
        ipcHandler.initialize();
        log('INFO', 'IPC handler initialized');

        // Start HTTP server for mobile file access
        await startHTTPServer();
        log('INFO', `HTTP server started on port ${SERVICE_CONFIG.port}`);

        // Initialize tray
        trayManager = new TrayManager({
            onShowWindow: showMainWindow,
            onQuit: () => { isQuitting = true; app.quit(); },
            onToggleTask: toggleTask,
            onOpenDashboard: openDashboard,
            onViewLogs: viewLogs
        });
        await trayManager.initialize();
        log('INFO', 'Tray manager initialized');

        // Start the scheduler
        await taskScheduler.start();
        log('INFO', 'Service started successfully');

        // Show startup notification
        notificationManager.show({
            title: 'Aartiq Service Started',
            body: 'Background automation is running',
            silent: true
        });

    } catch (error) {
        log('ERROR', 'Failed to initialize service:', error);
        notificationManager.show({
            title: 'Service Error',
            body: 'Failed to start automation service',
            silent: false
        });
    }
}

// Handle tasks that become due
async function handleTaskDue(task) {
    log('INFO', `Task due: ${task.name} (${task.id})`);

    // Update task status
    task.lastRun = new Date();
    task.status = 'running';
    await storageManager.saveTask(task);

    // Notify mobile
    mobileNotifier.notifyTaskStarted(task);

    // Show desktop notification
    if (task.notification?.onStart) {
        notificationManager.show({
            title: '⏰ Task Starting',
            body: task.name,
            silent: true
        });
    }

    // Queue the task for execution
    try {
        await taskQueue.enqueue(task);
    } catch (error) {
        log('ERROR', `Failed to enqueue task ${task.id}:`, error);
        task.lastStatus = 'failed';
        task.lastError = error.message;
        await storageManager.saveTask(task);
    }
}

// Handle missed tasks (after sleep/wake)
async function handleTaskMissed(task) {
    log('INFO', `Task missed: ${task.name} (${task.id})`);

    // Show notification about missed task
    notificationManager.show({
        title: '⏰ Missed Task',
        body: `${task.name} was scheduled while system was asleep. Running now...`,
        silent: false
    });

    // Execute the task
    await handleTaskDue(task);
}

// Start HTTP server for mobile file access
async function startHTTPServer() {
    const http = require('http');
    const fs = require('fs');
    const url = require('url');

    // Loopback unless AARTIQ_SERVICE_HOST says otherwise (docs-audit M3).
    const serviceHost = resolveServiceHost();

    httpServer = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;

        // No Access-Control-Allow-Origin header: without it a page open in any
        // browser on this machine cannot read these responses. The mobile
        // clients are native HTTP clients and never needed it.
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // Health check endpoint
        if (pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', service: 'Aartiq' }));
            return;
        }

        // List files in public directory
        if (pathname === '/files') {
            const files = fs.readdirSync(SERVICE_CONFIG.publicPath);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ files }));
            return;
        }

        // Serve files from public directory
        const filePath = path.join(SERVICE_CONFIG.publicPath, pathname.replace(/^\//, ''));

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
                '.pdf': 'application/pdf',
                '.txt': 'text/plain',
                '.json': 'application/json',
                '.html': 'text/html'
            };
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
            res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
            fs.createReadStream(filePath).pipe(res);
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found' }));
        }
    });

    return new Promise((resolve, reject) => {
        httpServer.listen(SERVICE_CONFIG.port, serviceHost, () => {
            resolve();
        });
        httpServer.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                log('WARN', `Port ${SERVICE_CONFIG.port} in use, trying ${SERVICE_CONFIG.port + 1}`);
                httpServer.listen(SERVICE_CONFIG.port + 1, serviceHost, () => {
                    SERVICE_CONFIG.port = SERVICE_CONFIG.port + 1;
                    resolve();
                });
            } else {
                reject(error);
            }
        });
    });
}

// Show main browser window
function showMainWindow() {
    // This would be handled by the main browser app
    log('INFO', 'Request to show main window');
}

// Toggle task enabled/disabled
function toggleTask(taskId) {
    taskScheduler.toggleTask(taskId);
}

// Open task dashboard
function openDashboard() {
    // Open browser with dashboard
    const { shell } = require('electron');
    shell.openExternal(`aartiq://dashboard/automation`);
}

// View execution logs
function viewLogs() {
    const logPath = path.join(SERVICE_CONFIG.storagePath, 'logs');
    const { shell } = require('electron');
    shell.openPath(logPath);
}

// Handle app events
app.on('ready', async () => {
    log('INFO', 'App ready event received');
    await initializeService();
});

app.on('window-all-closed', () => {
    // Don't quit on window close - we're a background service
    log('INFO', 'All windows closed, running in background');
});

app.on('before-quit', () => {
    log('INFO', 'Service shutting down...');
    isQuitting = true;

    // Save state
    if (taskScheduler) {
        taskScheduler.stop();
    }

    // Close HTTP server
    if (httpServer) {
        httpServer.close();
    }

    log('INFO', 'Service shutdown complete');
});

app.on('second-instance', () => {
    // Another instance tried to start, focus our window or tray
    log('INFO', 'Second instance attempted to start');
    if (trayManager) {
        trayManager.show();
    }
});

// Handle certificate errors (for development)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    if (app.isPackaged) {
        callback(false);
    } else {
        event.preventDefault();
        callback(true);
    }
});

// Handle power events
powerMonitor.on('suspend', () => {
    log('INFO', 'System suspending');
    if (taskScheduler) {
        taskScheduler.onSuspend();
    }
});

powerMonitor.on('resume', () => {
    log('INFO', 'System resuming');
    if (taskScheduler) {
        taskScheduler.onResume();
    }
});

powerMonitor.on('on-ac', () => {
    log('INFO', 'System on AC power');
});

powerMonitor.on('on-battery', () => {
    log('INFO', 'System on battery power');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    log('ERROR', 'Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    log('ERROR', 'Unhandled rejection at:', promise, 'reason:', reason);
});

module.exports = { SERVICE_CONFIG };
