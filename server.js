const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8080;
const ROOT = __dirname;                 // files are only ever served from here
const MAX_BACKUPS = 30;                 // rolling save history

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

function dbPath() {
    return process.env.DATA_DIR
        ? path.join(process.env.DATA_DIR, 'campaign_state.json')
        : path.join(ROOT, 'campaign_state.json');
}

/* ============================================================
   DM notes — kept OUT of campaign_state.json on purpose.
   The campaign state is broadcast to every player's browser, so
   anything stored there is readable by anyone. These notes live in
   their own file and are only ever sent in response to a request
   carrying the correct PIN.
   ============================================================ */

function dmPath() {
    return process.env.DATA_DIR
        ? path.join(process.env.DATA_DIR, 'dm_notes.json')
        : path.join(ROOT, 'dm_notes.json');
}

function readDm() {
    try {
        return JSON.parse(fs.readFileSync(dmPath(), 'utf8'));
    } catch (e) {
        return null;
    }
}

function writeDm(obj) {
    const target = dmPath();
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    fs.renameSync(tmp, target);
}

function hashPin(pin, salt) {
    return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

function pinValid(pin) {
    const dm = readDm();
    if (!dm || !dm.pinHash) return false;
    const attempt = Buffer.from(hashPin(pin, dm.salt), 'hex');
    const stored = Buffer.from(dm.pinHash, 'hex');
    if (attempt.length !== stored.length) return false;
    return crypto.timingSafeEqual(attempt, stored);   // constant-time compare
}

// Simple brute-force brake: a 4-digit PIN is only 10,000 guesses.
const failures = new Map();
function throttled(ip) {
    const f = failures.get(ip);
    if (!f) return 0;
    if (f.count < 5) return 0;
    const waitMs = 30000 - (Date.now() - f.last);
    return waitMs > 0 ? Math.ceil(waitMs / 1000) : 0;
}
function noteFailure(ip) {
    const f = failures.get(ip) || { count: 0, last: 0 };
    f.count++;
    f.last = Date.now();
    failures.set(ip, f);
}
function clearFailures(ip) {
    failures.delete(ip);
}

/**
 * Save the campaign atomically, keeping a rolling set of backups.
 * Writing to a temp file and renaming means a crash or power loss can never
 * leave a half-written (unreadable) campaign_state.json behind.
 */
function saveStateSafely(body, callback) {
    const target = dbPath();
    const dir = path.dirname(target);

    try {
        // 1. Snapshot whatever is currently on disk before overwriting it.
        if (fs.existsSync(target)) {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backup = path.join(dir, `campaign_state.backup-${stamp}.json`);
            try {
                fs.copyFileSync(target, backup);
            } catch (e) {
                console.warn('Could not write backup:', e.message);
            }

            // 2. Trim to the newest MAX_BACKUPS.
            try {
                const olds = fs.readdirSync(dir)
                    .filter(f => f.startsWith('campaign_state.backup-') && f.endsWith('.json'))
                    .sort();
                while (olds.length > MAX_BACKUPS) {
                    fs.unlinkSync(path.join(dir, olds.shift()));
                }
            } catch (e) { /* trimming is best-effort */ }
        }

        // 3. Atomic replace.
        const tmp = target + '.tmp';
        fs.writeFileSync(tmp, body, 'utf8');
        fs.renameSync(tmp, target);
        callback(null);
    } catch (err) {
        callback(err);
    }
}

const server = http.createServer((req, res) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

    const urlPath = req.url.split('?')[0];

    // ---------- 1. Collaborative state sync ----------
    if (urlPath === '/api/state') {
        if (req.method === 'GET') {
            fs.readFile(dbPath(), 'utf8', (err, data) => {
                if (err) {
                    const code = err.code === 'ENOENT' ? 404 : 500;
                    res.writeHead(code, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        error: code === 404 ? 'No state initialized' : err.code
                    }));
                } else {
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-store'
                    });
                    res.end(data);
                }
            });
        } else if (req.method === 'POST') {
            let body = '';
            let tooBig = false;
            req.on('data', chunk => {
                body += chunk.toString();
                if (body.length > 25 * 1024 * 1024) {   // 25 MB ceiling
                    tooBig = true;
                    req.destroy();
                }
            });
            req.on('end', () => {
                if (tooBig) return;
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
                    return;
                }
                // Refuse to overwrite a good campaign with an empty shell.
                if (!parsed || !Array.isArray(parsed.campaigns) || parsed.campaigns.length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Refusing to save a state with no campaigns' }));
                    return;
                }
                saveStateSafely(body, (err) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Failed to save campaign state' }));
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                });
            });
        } else {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        }
        return;
    }

    // ---------- 1b. DM notes (PIN protected) ----------
    if (urlPath.startsWith('/api/dm-notes')) {
        const ip = req.socket.remoteAddress || 'unknown';
        const send = (code, obj) => {
            const b = JSON.stringify(obj);
            res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(b);
        };

        if (urlPath === '/api/dm-notes/status' && req.method === 'GET') {
            const dm = readDm();
            send(200, { configured: !!(dm && dm.pinHash) });
            return;
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', c => {
                body += c.toString();
                if (body.length > 5 * 1024 * 1024) req.destroy();
            });
            req.on('end', () => {
                let p;
                try { p = JSON.parse(body || '{}'); }
                catch (e) { send(400, { error: 'Invalid JSON' }); return; }

                const wait = throttled(ip);
                if (wait > 0) {
                    send(429, { error: `Too many attempts. Try again in ${wait}s.` });
                    return;
                }

                const dm = readDm();
                const configured = !!(dm && dm.pinHash);

                // First-time setup: choose the PIN.
                if (urlPath === '/api/dm-notes/setup') {
                    if (configured) { send(409, { error: 'A PIN is already set.' }); return; }
                    const pin = String(p.pin || '');
                    if (pin.length < 4) { send(400, { error: 'PIN must be at least 4 characters.' }); return; }
                    const salt = crypto.randomBytes(16).toString('hex');
                    writeDm({ salt, pinHash: hashPin(pin, salt), notes: '', updated: Date.now() });
                    send(200, { ok: true });
                    return;
                }

                if (!configured) { send(409, { error: 'No PIN set yet.' }); return; }
                if (!pinValid(p.pin)) {
                    noteFailure(ip);
                    send(401, { error: 'Incorrect PIN.' });
                    return;
                }
                clearFailures(ip);

                if (urlPath === '/api/dm-notes/unlock') {
                    send(200, { ok: true, notes: dm.notes || '' });
                    return;
                }

                if (urlPath === '/api/dm-notes/save') {
                    dm.notes = typeof p.notes === 'string' ? p.notes : '';
                    dm.updated = Date.now();
                    writeDm(dm);
                    send(200, { ok: true, updated: dm.updated });
                    return;
                }

                if (urlPath === '/api/dm-notes/change-pin') {
                    const next = String(p.newPin || '');
                    if (next.length < 4) { send(400, { error: 'PIN must be at least 4 characters.' }); return; }
                    const salt = crypto.randomBytes(16).toString('hex');
                    dm.salt = salt;
                    dm.pinHash = hashPin(next, salt);
                    writeDm(dm);
                    send(200, { ok: true });
                    return;
                }

                send(404, { error: 'Unknown DM notes action' });
            });
            return;
        }

        send(405, { error: 'Method Not Allowed' });
        return;
    }

    // ---------- 2. Static files (contained to ROOT) ----------
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath);
    } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>400 Bad Request</h1><p>Malformed URL.</p>', 'utf-8');
        return;
    }

    // Resolve, then verify the result is still inside ROOT. This blocks
    // ../ traversal (raw or percent-encoded) reaching files outside the app.
    let filePath = path.resolve(ROOT, '.' + path.posix.normalize('/' + decoded));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/html' });
        res.end('<h1>403 Forbidden</h1>', 'utf-8');
        return;
    }

    // Never hand out the save file or its backups over the static route.
    const base = path.basename(filePath);
    if (base.startsWith('campaign_state.backup-') || base === 'campaign_state.json.tmp'
        || base === 'dm_notes.json' || base === 'dm_notes.json.tmp') {
        res.writeHead(403, { 'Content-Type': 'text/html' });
        res.end('<h1>403 Forbidden</h1>', 'utf-8');
        return;
    }

    try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }
    } catch (e) { /* fall through to 404 */ }

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 Not Found</h1>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end(`Server error: ${error.code}\n`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log('==================================================');
    console.log('Beer Club D&D Campaign Tracker');
    console.log(`Listening on port ${PORT}`);
    console.log(`Save file: ${dbPath()}`);
    console.log(`Keeping the newest ${MAX_BACKUPS} backups alongside it.`);
    console.log('==================================================');
});
