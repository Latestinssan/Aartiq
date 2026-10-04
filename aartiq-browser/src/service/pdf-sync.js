/**
 * PDF Sync Service
 * 
 * Manages PDF files for mobile access.
 * Serves files via HTTP and notifies mobile devices of new files.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const pdfjsLib = require('pdfjs-dist');
const sharp = require('sharp');
const { resolveServiceHost } = require('./service-bind');

class PDFSyncService extends EventEmitter {
    constructor(options = {}) {
        super();
        this.port = options.port || 3999;
        this.publicDir = options.publicDir || path.join(process.env.HOME || process.env.USERPROFILE, 'Documents', 'Aartiq', 'public');
        this.server = null;
        this.isRunning = false;
        this.fileIndex = new Map(); // filename -> metadata
        this.authToken = options.authToken || process.env.AARTIQ_PDF_SYNC_TOKEN || crypto.randomBytes(32).toString('hex');
    }

    getAuthToken() {
        return this.authToken;
    }

    setAuthToken(token) {
        this.authToken = token;
    }

    _extractToken(req) {
        const auth = req.headers && req.headers.authorization;
        if (typeof auth === 'string') {
            const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
            if (m) return m[1].trim();
        }
        if (req.headers && req.headers['x-aartiq-token']) {
            return String(req.headers['x-aartiq-token']).trim();
        }
        try {
            const parsedUrl = new URL(req.url, `http://localhost:${this.port}`);
            const queryToken = parsedUrl.searchParams.get('token');
            if (queryToken) return queryToken.trim();
        } catch (_) {}
        return null;
    }

    _verifyToken(token) {
        if (!token || typeof token !== 'string') return false;
        if (!this.authToken || typeof this.authToken !== 'string') return false;
        const expected = Buffer.from(this.authToken, 'utf8');
        const actual = Buffer.from(token, 'utf8');
        if (expected.length !== actual.length) {
            crypto.timingSafeEqual(expected, expected);
            return false;
        }
        return crypto.timingSafeEqual(expected, actual);
    }

    async initialize() {
        // Ensure public directory exists
        if (!fs.existsSync(this.publicDir)) {
            fs.mkdirSync(this.publicDir, { recursive: true });
        }

        // Build file index
        await this.buildFileIndex();

        // Start HTTP server
        await this.startServer();

        console.log(`[PDFSync] Initialized on port ${this.port}`);
        console.log(`[PDFSync] Serving files from: ${this.publicDir}`);
    }

    async startServer() {
        // Loopback unless AARTIQ_SERVICE_HOST says otherwise (docs-audit M3).
        const host = resolveServiceHost();
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res);
            });

            this.server.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    console.warn(`[PDFSync] Port ${this.port} in use, trying ${this.port + 1}`);
                    this.port++;
                    this.server.listen(this.port, host, () => {
                        resolve();
                    });
                } else {
                    reject(error);
                }
            });

            this.server.listen(this.port, host, () => {
                this.isRunning = true;
                resolve();
            });
        });
    }

    handleRequest(req, res) {
        // No Access-Control-Allow-Origin header: without it a page open in any
        // browser on this machine cannot read these responses. The mobile
        // clients are native HTTP clients and never needed it.
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // Host header validation to prevent DNS rebinding
        const rawHost = (req.headers.host || '').split(':')[0].toLowerCase();
        const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
        const resolvedHost = resolveServiceHost();
        if (resolvedHost) allowedHosts.add(resolvedHost.toLowerCase());
        if (!allowedHosts.has(rawHost)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden', message: 'Invalid Host header' }));
            return;
        }

        // Token authentication check (Issue 3: Require authentication on sync listeners)
        const token = this._extractToken(req);
        if (!this._verifyToken(token)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized', message: 'Authentication required' }));
            return;
        }

        const url = new URL(req.url, `http://localhost:${this.port}`);
        const pathname = url.pathname;

        // Handle routes
        if (pathname === '/' || pathname === '/index.html') {
            this.serveIndex(res);
        } else if (pathname === '/api/files') {
            this.serveFileList(res);
        } else if (pathname === '/api/status') {
            this.serveStatus(res);
        } else if (pathname.startsWith('/download/')) {
            // Download a file
            const filename = decodeURIComponent(pathname.replace('/download/', ''));
            this.serveDownload(res, filename);
        } else if (pathname.startsWith('/preview/')) {
            // Get file preview (first page thumbnail)
            const filename = decodeURIComponent(pathname.replace('/preview/', ''));
            this.servePreview(res, filename);
        } else {
            // Serve file directly
            const filepath = path.join(this.publicDir, pathname.replace(/^\//, ''));
            this.serveFile(res, filepath);
        }
    }

    serveIndex(res) {
        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Aartiq Files</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0a;
            color: #fff;
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 800px; margin: 0 auto; }
        h1 { color: #00e5ff; margin-bottom: 20px; font-size: 24px; }
        .file-list { list-style: none; }
        .file-item {
            background: rgba(255,255,255,0.05);
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 16px;
            transition: background 0.2s;
        }
        .file-item:hover { background: rgba(255,255,255,0.1); }
        .file-icon {
            width: 48px;
            height: 48px;
            background: rgba(239, 68, 68, 0.2);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
        }
        .file-info { flex: 1; }
        .file-name { font-weight: 600; margin-bottom: 4px; }
        .file-meta { font-size: 12px; color: rgba(255,255,255,0.5); }
        .download-btn {
            background: #00e5ff;
            color: #000;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            text-decoration: none;
        }
        .download-btn:hover { background: #00c4d4; }
        .empty { text-align: center; padding: 40px; color: rgba(255,255,255,0.5); }
    </style>
</head>
<body>
    <div class="container">
        <h1>📄 Aartiq Files</h1>
        <div id="file-list"></div>
    </div>
    <script>
        async function loadFiles() {
            try {
                const res = await fetch('/api/files');
                const data = await res.json();
                const list = document.getElementById('file-list');
                
                if (data.files.length === 0) {
                    list.innerHTML = '<div class="empty">No files available</div>';
                    return;
                }
                
                list.innerHTML = data.files.map(function(file) {
                    return '<div class="file-item">' +
                        '<div class="file-icon">📄</div>' +
                        '<div class="file-info">' +
                            '<div class="file-name">' + file.name + '</div>' +
                            '<div class="file-meta">' + file.sizeFormatted + ' • ' + file.date + '</div>' +
                        '</div>' +
                        '<a href="/download/' + encodeURIComponent(file.name) + '" class="download-btn" download>Download</a>' +
                    '</div>';
                }).join('');
            } catch (e) {
                console.error('Failed to load files:', e);
            }
        }
        loadFiles();
    </script>
</body>
</html>
        `;
        
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    }

    serveFileList(res) {
        const files = Array.from(this.fileIndex.values());
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ files, count: files.length }));
    }

    serveStatus(res) {
        const status = {
            running: this.isRunning,
            port: this.port,
            publicDir: this.publicDir,
            fileCount: this.fileIndex.size
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
    }

    serveFile(res, filepath) {
        if (!fs.existsSync(filepath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found' }));
            return;
        }

        const stat = fs.statSync(filepath);
        const ext = path.extname(filepath).toLowerCase();
        
        const mimeTypes = {
            '.pdf': 'application/pdf',
            '.txt': 'text/plain',
            '.json': 'application/json',
            '.html': 'text/html',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg'
        };

        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(filepath)}"`);

        const stream = fs.createReadStream(filepath);
        stream.pipe(res);
    }

    serveDownload(res, filename) {
        const filepath = path.join(this.publicDir, filename);
        
        if (!fs.existsSync(filepath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found' }));
            return;
        }

        const stat = fs.statSync(filepath);
        const ext = path.extname(filepath).toLowerCase();

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        const stream = fs.createReadStream(filepath);
        stream.pipe(res);
    }

    async servePreview(res, filename) {
        const filepath = path.join(this.publicDir, filename);
        
        if (!fs.existsSync(filepath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found' }));
            return;
        }

        try {
            const pdfBuffer = fs.readFileSync(filepath);
            const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
            const page = await pdf.getPage(1);
            
            const viewport = page.getViewport({ scale: 1.5 });
            const width = Math.floor(viewport.width);
            const height = Math.floor(viewport.height);
            
            const title = filename.replace(/\.pdf$/i, '').replace(/_/g, ' ').replace(/-/g, ' ');
            const pageCount = pdf.numPages;
            
            const svg = `
            <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#0f172a;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#1e293b;stop-opacity:1" />
                    </linearGradient>
                    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" style="stop-color:#38bdf8;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#818cf8;stop-opacity:1" />
                    </linearGradient>
                </defs>
                <rect width="100%" height="100%" fill="url(#bg)"/>
                <rect x="40" y="40" width="${width-80}" height="${height-80}" fill="none" stroke="#38bdf8" stroke-width="2" rx="20" opacity="0.3"/>
                <text x="50%" y="35%" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="url(#accent)" text-anchor="middle">${title}</text>
                <text x="50%" y="45%" font-family="Arial, sans-serif" font-size="16" fill="#94a3b8" text-anchor="middle">${pageCount} page${pageCount > 1 ? 's' : ''}</text>
                <text x="50%" y="70%" font-family="Arial, sans-serif" font-size="14" fill="#64748b" text-anchor="middle">Generated by Aartiq</text>
                <text x="50%" y="76%" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#38bdf8" text-anchor="middle">Premium AI Browser</text>
            </svg>`;
            
            const imageBuffer = await sharp(Buffer.from(svg))
                .jpeg({ quality: 80 })
                .toBuffer();
            
            const imageBase64 = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                thumbnail: imageBase64,
                width,
                height,
                pageCount: pdf.numPages,
                title: title
            }));
        } catch (err) {
            console.error('[PDFSync] Preview generation failed:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Preview generation failed', details: err.message }));
        }
    }

    async buildFileIndex() {
        this.fileIndex.clear();
        
        if (!fs.existsSync(this.publicDir)) {
            return;
        }

        const files = fs.readdirSync(this.publicDir);
        
        for (const file of files) {
            const filepath = path.join(this.publicDir, file);
            const stat = fs.statSync(filepath);
            
            if (stat.isFile()) {
                this.fileIndex.set(file, {
                    name: file,
                    path: filepath,
                    size: stat.size,
                    sizeFormatted: this.formatSize(stat.size),
                    date: stat.mtime.toISOString().split('T')[0],
                    url: `http://localhost:${this.port}/${encodeURIComponent(file)}`
                });
            }
        }

        console.log(`[PDFSync] Indexed ${this.fileIndex.size} files`);
    }

    formatSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    // Add a file to the sync directory
    async addFile(sourcePath, filename) {
        const destPath = path.join(this.publicDir, filename);
        
        // Ensure directory exists
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Copy file
        fs.copyFileSync(sourcePath, destPath);

        // Update index
        const stat = fs.statSync(destPath);
        this.fileIndex.set(filename, {
            name: filename,
            path: destPath,
            size: stat.size,
            sizeFormatted: this.formatSize(stat.size),
            date: stat.mtime.toISOString().split('T')[0],
            url: `http://localhost:${this.port}/${encodeURIComponent(filename)}`
        });

        // Notify listeners
        this.emit('file-added', {
            name: filename,
            url: this.getFileUrl(filename),
            size: stat.size
        });

        console.log(`[PDFSync] Added file: ${filename}`);
        return destPath;
    }

    // Remove a file from sync
    async removeFile(filename) {
        const filepath = path.join(this.publicDir, filename);
        
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            this.fileIndex.delete(filename);
            
            this.emit('file-removed', { name: filename });
            console.log(`[PDFSync] Removed file: ${filename}`);
        }
    }

    // Get URL for a file
    getFileUrl(filename) {
        return `http://localhost:${this.port}/${encodeURIComponent(filename)}`;
    }

    // Get all files
    getFiles() {
        return Array.from(this.fileIndex.values());
    }

    // Stop the server
    stop() {
        if (this.server) {
            this.server.close();
            this.isRunning = false;
            console.log('[PDFSync] Server stopped');
        }
    }

    // Restart the server
    async restart() {
        this.stop();
        await this.initialize();
    }

    getStatus() {
        return {
            running: this.isRunning,
            port: this.port,
            publicDir: this.publicDir,
            fileCount: this.fileIndex.size,
            files: this.getFiles()
        };
    }
}

module.exports = { PDFSyncService };
