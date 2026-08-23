const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');

const PORT = 8080;
const ROOT = __dirname;
const MAX_BACKUPS = 30;

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
    return store.monolithPath();
}

/* ============================================================
   DM notes — PIN protected, separate file
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
    fs.mkdirSync(path.dirname(target), { recursive: true });
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
    return crypto.timingSafeEqual(attempt, stored);
}

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

function saveStateSafely(body, callback) {
    const target = dbPath();
    const dir = path.dirname(target);
    try {
        if (fs.existsSync(target)) {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backup = path.join(dir, `campaign_state.backup-${stamp}.json`);
            try { fs.copyFileSync(target, backup); } catch (e) {
                console.warn('Could not write backup:', e.message);
            }
            try {
                const olds = fs.readdirSync(dir)
                    .filter(f => f.startsWith('campaign_state.backup-') && f.endsWith('.json'))
                    .sort();
                while (olds.length > MAX_BACKUPS) {
                    fs.unlinkSync(path.join(dir, olds.shift()));
                }
            } catch (e) { /* best-effort */ }
        }
        const tmp = target + '.tmp';
        fs.writeFileSync(tmp, body, 'utf8');
        fs.renameSync(tmp, target);
        callback(null);
    } catch (err) {
        callback(err);
    }
}

function json(res, code, obj) {
    const b = JSON.stringify(obj);
    res.writeHead(code, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
    });
    res.end(b);
}

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        let body = '';
        let tooBig = false;
        req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > limit) {
                tooBig = true;
                req.destroy();
            }
        });
        req.on('end', () => {
            if (tooBig) return reject(Object.assign(new Error('too_large'), { status: 413 }));
            resolve(body);
        });
        req.on('error', reject);
    });
}

function sessionToken(req, parsed) {
    return req.headers['x-session-token']
        || (parsed && parsed.sessionToken)
        || '';
}

function match(urlPath, pattern) {
    // pattern like /api/characters/:campaignId/:charId
    const pp = pattern.split('/').filter(Boolean);
    const up = urlPath.split('/').filter(Boolean);
    if (pp.length !== up.length) return null;
    const params = {};
    for (let i = 0; i < pp.length; i++) {
        if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(up[i]);
        else if (pp[i] !== up[i]) return null;
    }
    return params;
}

// Startup migration
try {
    const m = store.migrateIfNeeded();
    if (m.migrated) console.log('[boot] Split-file migration complete');
} catch (e) {
    console.error('[boot] migrate failed:', e);
}

const server = http.createServer(async (req, res) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    const urlPath = req.url.split('?')[0];

    try {
        /* ---------- Entry / seats ---------- */
        if (urlPath === '/api/entry' && req.method === 'GET') {
            return json(res, 200, store.buildEntry());
        }

        if (urlPath === '/api/seats/claim' && req.method === 'POST') {
            const raw = await readBody(req, 1e6);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const result = store.claimSeat({
                campaignId: p.campaignId,
                characterId: p.characterId,
                label: p.label,
                steal: !!p.steal
            });
            return json(res, result.status, result.status === 200 ? result : result);
        }

        if (urlPath === '/api/seats/dm' && req.method === 'POST') {
            const ip = req.socket.remoteAddress || 'unknown';
            const raw = await readBody(req, 1e6);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const wait = throttled(ip);
            if (wait > 0) return json(res, 429, { error: `Too many attempts. Try again in ${wait}s.` });
            const dm = readDm();
            const configured = !!(dm && dm.pinHash);
            if (!configured) {
                // Allow DM seat without PIN if never configured (first run)
                const result = store.claimDmSeat({ label: p.label || 'DM' });
                return json(res, 200, result);
            }
            if (!pinValid(p.pin)) {
                noteFailure(ip);
                return json(res, 401, { error: 'Incorrect PIN.' });
            }
            clearFailures(ip);
            const result = store.claimDmSeat({ label: p.label || 'DM' });
            return json(res, 200, result);
        }

        if (urlPath === '/api/seats/heartbeat' && req.method === 'POST') {
            const raw = await readBody(req, 1e5);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const token = sessionToken(req, p);
            const result = store.heartbeat(token);
            return json(res, result.status, result);
        }

        if (urlPath === '/api/seats/release' && req.method === 'POST') {
            const raw = await readBody(req, 1e5);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const token = sessionToken(req, p);
            store.releaseSession(token);
            return json(res, 200, { ok: true });
        }

        /* ---------- Snapshot ---------- */
        if (urlPath === '/api/snapshot' && req.method === 'GET') {
            store.migrateIfNeeded();
            const snap = store.buildSnapshot();
            if (!snap) return json(res, 404, { error: 'No state initialized' });
            return json(res, 200, snap);
        }

        /* ---------- Character APIs ---------- */
        let params;

        params = match(urlPath, '/api/characters/:campaignId/:charId/offers/:offerId/accept');
        if (params && req.method === 'POST') {
            const raw = await readBody(req, 1e5);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const result = store.acceptOffer(params.campaignId, params.charId, params.offerId, sessionToken(req, p));
            return json(res, result.status, result);
        }

        params = match(urlPath, '/api/characters/:campaignId/:charId/offers/:offerId/deny');
        if (params && req.method === 'POST') {
            const raw = await readBody(req, 1e5);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const result = store.denyOffer(params.campaignId, params.charId, params.offerId, sessionToken(req, p));
            return json(res, result.status, result);
        }

        params = match(urlPath, '/api/characters/:campaignId/:charId/ack-dm-force');
        if (params && req.method === 'POST') {
            const raw = await readBody(req, 1e5);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const result = store.ackDmForce(params.campaignId, params.charId, sessionToken(req, p));
            return json(res, result.status, result);
        }

        params = match(urlPath, '/api/characters/:campaignId/:charId/dm-lock');
        if (params && req.method === 'POST') {
            const ip = req.socket.remoteAddress || 'unknown';
            const raw = await readBody(req, 1e5);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const sess = store.getSession(sessionToken(req, p));
            const dmOk = (sess && sess.role === 'dm') || pinValid(p.pin);
            if (!dmOk) {
                if (p.pin) noteFailure(ip);
                return json(res, 401, { error: 'DM authorization required' });
            }
            const result = store.setDmEditLock(params.campaignId, params.charId, true, p.note);
            return json(res, result.status, result);
        }

        params = match(urlPath, '/api/characters/:campaignId/:charId/dm-unlock');
        if (params && req.method === 'POST') {
            const ip = req.socket.remoteAddress || 'unknown';
            const raw = await readBody(req, 1e5);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const sess = store.getSession(sessionToken(req, p));
            const dmOk = (sess && sess.role === 'dm') || pinValid(p.pin);
            if (!dmOk) {
                if (p.pin) noteFailure(ip);
                return json(res, 401, { error: 'DM authorization required' });
            }
            const result = store.setDmEditLock(params.campaignId, params.charId, false);
            return json(res, result.status, result);
        }

        params = match(urlPath, '/api/characters/:campaignId/:charId');
        if (params && req.method === 'PUT') {
            const raw = await readBody(req, 25 * 1024 * 1024);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const result = store.putCharacter(params.campaignId, params.charId, {
                baseRevision: p.baseRevision,
                data: p.data,
                sessionToken: sessionToken(req, p)
            });
            return json(res, result.status, result);
        }

        if (params && req.method === 'GET') {
            const doc = store.readDoc(store.characterPath(params.campaignId, params.charId));
            if (!doc) return json(res, 404, { error: 'Not found' });
            return json(res, 200, {
                revision: doc.revision,
                data: doc.data,
                claim: doc.claim,
                dmEditLock: doc.dmEditLock,
                pendingOffers: (doc.pendingOffers || []).map(o => ({
                    id: o.id, fromLabel: o.fromLabel, summary: o.summary, createdAt: o.createdAt, baseRevision: o.baseRevision
                })),
                lastDmForce: doc.lastDmForce
            });
        }

        /* ---------- Combat / map / meta ---------- */
        params = match(urlPath, '/api/combat/:campaignId');
        if (params && req.method === 'PUT') {
            const raw = await readBody(req, 25 * 1024 * 1024);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const result = store.putCombat(params.campaignId, p.baseRevision, p.data);
            return json(res, result.status, result);
        }

        params = match(urlPath, '/api/map/:campaignId');
        if (params && req.method === 'PUT') {
            const raw = await readBody(req, 10 * 1024 * 1024);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const result = store.putMap(params.campaignId, p.baseRevision, p.data);
            return json(res, result.status, result);
        }

        params = match(urlPath, '/api/meta/:campaignId');
        if (params && req.method === 'PUT') {
            const raw = await readBody(req, 10 * 1024 * 1024);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const result = store.putMeta(params.campaignId, p.baseRevision, p.data);
            return json(res, result.status, result);
        }

        /* ---------- Compat /api/state ---------- */
        if (urlPath === '/api/state') {
            if (req.method === 'GET') {
                store.migrateIfNeeded();
                const snap = store.buildSnapshot();
                if (snap) {
                    // strip internal-only heavy fields for old clients optional — keep extras
                    return json(res, 200, snap);
                }
                // fallback monolith
                fs.readFile(dbPath(), 'utf8', (err, data) => {
                    if (err) {
                        const code = err.code === 'ENOENT' ? 404 : 500;
                        return json(res, code, { error: code === 404 ? 'No state initialized' : err.code });
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                    res.end(data);
                });
                return;
            }
            if (req.method === 'POST') {
                let body;
                try {
                    body = await readBody(req, 25 * 1024 * 1024);
                } catch (e) {
                    return json(res, e.status || 500, { error: e.message });
                }
                let parsed;
                try {
                    parsed = JSON.parse(body);
                } catch (e) {
                    return json(res, 400, { error: 'Invalid JSON payload' });
                }
                if (!parsed || !Array.isArray(parsed.campaigns) || parsed.campaigns.length === 0) {
                    return json(res, 400, { error: 'Refusing to save a state with no campaigns' });
                }
                try {
                    // Always write split layout + keep monolith backup mirror
                    store.writeSplitFromState(parsed);
                    saveStateSafely(body, (err) => {
                        if (err) console.warn('monolith mirror save failed:', err.message);
                        json(res, 200, { success: true, schemaVersion: store.SCHEMA_VERSION });
                    });
                } catch (e) {
                    console.error(e);
                    return json(res, 500, { error: 'Failed to save campaign state' });
                }
                return;
            }
            return json(res, 405, { error: 'Method Not Allowed' });
        }

        /* ---------- DM notes (unchanged) ---------- */
        if (urlPath.startsWith('/api/dm-notes')) {
            const ip = req.socket.remoteAddress || 'unknown';
            const send = (code, obj) => json(res, code, obj);

            if (urlPath === '/api/dm-notes/status' && req.method === 'GET') {
                const dm = readDm();
                return send(200, { configured: !!(dm && dm.pinHash) });
            }

            if (req.method === 'POST') {
                let body;
                try {
                    body = await readBody(req, 5 * 1024 * 1024);
                } catch (e) {
                    return send(e.status || 500, { error: e.message });
                }
                let p;
                try { p = JSON.parse(body || '{}'); }
                catch (e) { return send(400, { error: 'Invalid JSON' }); }

                const wait = throttled(ip);
                if (wait > 0) return send(429, { error: `Too many attempts. Try again in ${wait}s.` });

                const dm = readDm();
                const configured = !!(dm && dm.pinHash);

                if (urlPath === '/api/dm-notes/setup') {
                    if (configured) return send(409, { error: 'A PIN is already set.' });
                    const pin = String(p.pin || '');
                    if (pin.length < 4) return send(400, { error: 'PIN must be at least 4 characters.' });
                    const salt = crypto.randomBytes(16).toString('hex');
                    writeDm({ salt, pinHash: hashPin(pin, salt), notes: '', updated: Date.now() });
                    return send(200, { ok: true });
                }

                if (!configured) return send(409, { error: 'No PIN set yet.' });
                if (!pinValid(p.pin)) {
                    noteFailure(ip);
                    return send(401, { error: 'Incorrect PIN.' });
                }
                clearFailures(ip);

                if (urlPath === '/api/dm-notes/unlock') {
                    return send(200, { ok: true, notes: dm.notes || '' });
                }
                if (urlPath === '/api/dm-notes/save') {
                    dm.notes = typeof p.notes === 'string' ? p.notes : '';
                    dm.updated = Date.now();
                    writeDm(dm);
                    return send(200, { ok: true, updated: dm.updated });
                }
                if (urlPath === '/api/dm-notes/change-pin') {
                    const next = String(p.newPin || '');
                    if (next.length < 4) return send(400, { error: 'PIN must be at least 4 characters.' });
                    const salt = crypto.randomBytes(16).toString('hex');
                    dm.salt = salt;
                    dm.pinHash = hashPin(next, salt);
                    writeDm(dm);
                    return send(200, { ok: true });
                }
                return send(404, { error: 'Unknown DM notes action' });
            }
            return send(405, { error: 'Method Not Allowed' });
        }

        /* ---------- Static files ---------- */
        let decoded;
        try {
            decoded = decodeURIComponent(urlPath);
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<h1>400 Bad Request</h1><p>Malformed URL.</p>', 'utf-8');
            return;
        }

        let filePath = path.resolve(ROOT, '.' + path.posix.normalize('/' + decoded));
        if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
            res.writeHead(403, { 'Content-Type': 'text/html' });
            res.end('<h1>403 Forbidden</h1>', 'utf-8');
            return;
        }

        const base = path.basename(filePath);
        if (base.startsWith('campaign_state.backup-')
            || base.startsWith('campaign_state.pre-split')
            || base === 'campaign_state.json.tmp'
            || base === 'campaign_state.json'
            || base === 'dm_notes.json'
            || base === 'dm_notes.json.tmp'
            || base === 'manifest.json'
            || base === 'sessions.json'
            || base.endsWith('.tmp')) {
            res.writeHead(403, { 'Content-Type': 'text/html' });
            res.end('<h1>403 Forbidden</h1>', 'utf-8');
            return;
        }

        // Block data dir tree if under ROOT
        const dataDir = store.dataRoot();
        if (filePath === dataDir || filePath.startsWith(dataDir + path.sep)) {
            // Allow only if DATA_DIR is outside ROOT — if inside, forbid JSON data
            if (filePath.includes(path.sep + 'campaign' + path.sep)
                || base === 'manifest.json'
                || base === 'sessions.json') {
                res.writeHead(403, { 'Content-Type': 'text/html' });
                res.end('<h1>403 Forbidden</h1>', 'utf-8');
                return;
            }
        }

        try {
            if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
                filePath = path.join(filePath, 'index.html');
            }
        } catch (e) { /* fall through */ }

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
    } catch (e) {
        console.error('Request error:', e);
        if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
    }
});

server.listen(PORT, () => {
    console.log('==================================================');
    console.log('Beer Club D&D Campaign Tracker');
    console.log(`Listening on port ${PORT}`);
    console.log(`Data dir: ${store.dataRoot()}`);
    console.log(`Split layout: ${store.hasSplitLayout()}`);
    console.log(`Keeping up to ${MAX_BACKUPS} monolith backups.`);
    console.log('==================================================');
});
