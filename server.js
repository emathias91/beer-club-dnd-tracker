const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const board = require('./lib/board');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const MAX_BACKUPS = 30;
const MAX_MAP_BYTES = 25 * 1024 * 1024; // 25 MB

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

/** Maps live under DATA_DIR/maps (portable) with fallback to ROOT/maps. */
function mapsDir() {
    const primary = path.join(board.boardRoot(), 'maps');
    try {
        fs.mkdirSync(primary, { recursive: true });
        return primary;
    } catch (e) {
        const fallback = path.join(ROOT, 'maps');
        try { fs.mkdirSync(fallback, { recursive: true }); } catch (e2) { /* ignore */ }
        return fallback;
    }
}

function sanitizeMapFilename(name) {
    const base = path.basename(String(name || 'map.webp')).replace(/[^a-zA-Z0-9._-]+/g, '_');
    if (!base || base === '.' || base === '..') return 'map.webp';
    const ext = path.extname(base).toLowerCase();
    const allowed = ['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg'];
    if (!allowed.includes(ext)) return base + '.webp';
    return base;
}

function mapPublicUrl(filename) {
    return '/maps/' + encodeURIComponent(path.basename(filename));
}

function resolveMapFile(urlPath) {
    // /maps/foo.webp → mapsDir/foo.webp
    if (!urlPath.startsWith('/maps/')) return null;
    const raw = decodeURIComponent(urlPath.slice('/maps/'.length));
    const safe = path.basename(raw);
    if (!safe || safe === '.' || safe === '..') return null;
    const full = path.join(mapsDir(), safe);
    if (!full.startsWith(mapsDir() + path.sep) && full !== mapsDir()) return null;
    return full;
}
function dbPath() {
    return store.monolithPath();
}

/* ============================================================
   DM notes — PIN protected, separate file
   ============================================================ */

function dmPath() {
    // Per-game DM notes file (inside active game data root)
    return path.join(store.dataRoot(), 'dm_notes.json');
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

function gameAccessToken(req, parsed) {
    return req.headers['x-game-token']
        || (parsed && parsed.gameAccessToken)
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

// Startup: board registry + per-game migrate
try {
    board.ensureReady();
    const b = board.readBoard();
    console.log('[boot] Game board ready —', (b.games || []).map(g => g.id).join(', '));
    for (const g of b.games || []) {
        store.runWithDataRoot(board.gameRoot(g.id), () => {
            const m = store.migrateIfNeeded();
            if (m.migrated) console.log('[boot] Split-file migration complete for', g.id);
        });
    }
} catch (e) {
    console.error('[boot] board/migrate failed:', e);
}

const server = http.createServer(async (req, res) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    const urlPath = req.url.split('?')[0];

    try {
        /* ---------- Game Board (no table token) ---------- */
        if (urlPath === '/api/board' && req.method === 'GET') {
            return json(res, 200, board.listGamesPublic());
        }
        if (urlPath === '/api/board/unlock' && req.method === 'POST') {
            const ip = req.socket.remoteAddress || 'unknown';
            const raw = await readBody(req, 1e5);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const result = board.unlockGame(p.gameId, p.pin, ip);
            return json(res, result.status, result);
        }
        if (urlPath === '/api/board/setup-pin' && req.method === 'POST') {
            const ip = req.socket.remoteAddress || 'unknown';
            const raw = await readBody(req, 1e5);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            const result = board.setupGamePin(p.gameId, p.pin, ip);
            return json(res, result.status, result);
        }
        if (urlPath === '/api/board/leave' && req.method === 'POST') {
            const raw = await readBody(req, 1e5);
            let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
            board.revokeAccessToken(gameAccessToken(req, p));
            return json(res, 200, { ok: true });
        }

        /* Health (no auth) — for Docker/Azure probes */
        if (urlPath === '/api/health' && req.method === 'GET') {
            return json(res, 200, {
                ok: true,
                port: PORT,
                dataDir: board.boardRoot(),
                mapsDir: mapsDir(),
                node: process.version
            });
        }

        /* Map file existence check (table token) */
        if (urlPath === '/api/maps/check' && req.method === 'GET') {
            const access = board.resolveAccessToken(gameAccessToken(req, null));
            if (!access) {
                return json(res, 401, { error: 'Game table locked', code: 'game_auth' });
            }
            const q = (req.url.split('?')[1] || '');
            const params = new URLSearchParams(q);
            const name = params.get('path') || params.get('name') || '';
            const rel = String(name).replace(/^\/maps\//, '');
            const full = path.join(mapsDir(), path.basename(rel));
            const rootFallback = path.join(ROOT, path.basename(rel));
            const exists = (fs.existsSync(full) && fs.statSync(full).isFile())
                || (fs.existsSync(rootFallback) && fs.statSync(rootFallback).isFile());
            return json(res, 200, {
                exists,
                path: exists ? mapPublicUrl(path.basename(rel)) : null,
                mapsDir: mapsDir()
            });
        }

        /* Upload map into DATA_DIR/maps (table token; DM preferred but any seat OK for PoC) */
        if (urlPath === '/api/maps/upload' && req.method === 'POST') {
            const access = board.resolveAccessToken(gameAccessToken(req, null));
            if (!access) {
                return json(res, 401, { error: 'Game table locked', code: 'game_auth' });
            }
            let body;
            try {
                body = await readBody(req, MAX_MAP_BYTES * 1.4);
            } catch (e) {
                return json(res, e.status || 413, { error: e.message || 'Upload too large' });
            }
            let parsed;
            try {
                parsed = JSON.parse(body || '{}');
            } catch (e) {
                return json(res, 400, { error: 'Expected JSON { filename, dataBase64 }' });
            }
            const filename = sanitizeMapFilename(parsed.filename || parsed.name || 'campaign-map.webp');
            const b64 = String(parsed.dataBase64 || parsed.data || '').replace(/^data:[^;]+;base64,/, '');
            if (!b64) return json(res, 400, { error: 'Missing dataBase64' });
            let buf;
            try {
                buf = Buffer.from(b64, 'base64');
            } catch (e) {
                return json(res, 400, { error: 'Invalid base64' });
            }
            if (!buf.length) return json(res, 400, { error: 'Empty file' });
            if (buf.length > MAX_MAP_BYTES) {
                return json(res, 413, { error: 'Map too large (max 25 MB)' });
            }
            const dest = path.join(mapsDir(), filename);
            try {
                fs.writeFileSync(dest, buf);
            } catch (e) {
                console.error('map upload write failed', e);
                return json(res, 500, { error: 'Failed to save map file' });
            }
            return json(res, 200, {
                ok: true,
                filename,
                url: mapPublicUrl(filename),
                bytes: buf.length
            });
        }

        /* ---------- Table APIs require game unlock token ---------- */
        const isTableApi = urlPath.startsWith('/api/') && !urlPath.startsWith('/api/board');
        if (isTableApi) {
            const access = board.resolveAccessToken(gameAccessToken(req, null));
            if (!access) {
                return json(res, 401, {
                    error: 'Game table locked. Unlock from the Beer Club Game Board first.',
                    code: 'game_auth'
                });
            }
            const gameDataRoot = board.gameRoot(access.gameId);
            return await store.runWithDataRoot(gameDataRoot, async () => {
                await handleTableApi(req, res, urlPath, access);
            });
        }

        /* ---------- Static files ---------- */
        await serveStatic(req, res, urlPath);
    } catch (e) {
        console.error('Request error:', e);
        if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
    }
});

async function handleTableApi(req, res, urlPath, access) {
        /* ---------- Entry / seats ---------- */
        if (urlPath === '/api/entry' && req.method === 'GET') {
            const entry = store.buildEntry();
            entry.gameId = access.gameId;
            entry.gameName = (board.getGameMeta(access.gameId) || {}).name || access.gameId;
            return json(res, 200, entry);
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

        /* ---------- Full state (import/export/compat) ---------- */
        if (urlPath === '/api/state') {
            if (req.method === 'GET') {
                store.migrateIfNeeded();
                const snap = store.buildSnapshot();
                if (!snap) {
                    return fs.readFile(dbPath(), 'utf8', (err, data) => {
                        if (err) {
                            const code = err.code === 'ENOENT' ? 404 : 500;
                            return json(res, code, { error: code === 404 ? 'No state initialized' : err.code });
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                        res.end(data);
                    });
                }
                // strip internal-only heavy fields for old clients optional — keep extras
                return json(res, 200, {
                    campaigns: snap.campaigns,
                    activeCampaignId: snap.activeCampaignId,
                    combatants: snap.combatants,
                    activeCombatantIndex: snap.activeCombatantIndex,
                    combatRound: snap.combatRound,
                    rollHistory: snap.rollHistory
                });
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
                    // Allow empty campaigns for blank template tables
                    if (!parsed || !Array.isArray(parsed.campaigns)) {
                        return json(res, 400, { error: 'Refusing to save: campaigns must be an array' });
                    }
                }
                try {
                    // Always write split layout + keep monolith backup mirror
                    if (parsed.campaigns.length === 0) {
                        // blank table: write empty manifest
                        store.writeSplitFromState({
                            campaigns: [],
                            activeCampaignId: '',
                            combatants: parsed.combatants || [],
                            activeCombatantIndex: parsed.activeCombatantIndex || 0,
                            combatRound: parsed.combatRound || 1,
                            rollHistory: parsed.rollHistory || []
                        });
                    } else {
                        store.writeSplitFromState(parsed);
                    }
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

        /* ---------- DM notes (unchanged, per-game file) ---------- */
        if (urlPath.startsWith('/api/dm-notes')) {
            const ip = req.socket.remoteAddress || 'unknown';
            const send = (code, obj) => json(res, code, obj);

            if (urlPath === '/api/dm-notes/status' && req.method === 'GET') {
                const dm = readDm();
                return send(200, { configured: !!(dm && dm.pinHash) });
            }

            if (req.method === 'POST') {
                const raw = await readBody(req, 2e6);
                let p; try { p = JSON.parse(raw || '{}'); } catch (e) { return send(400, { error: 'Invalid JSON' }); }
                const wait = throttled(ip);
                if (wait > 0) return send(429, { error: `Too many attempts. Try again in ${wait}s.` });

                if (urlPath === '/api/dm-notes/setup') {
                    const pin = String(p.pin || '');
                    if (pin.length < 4) return send(400, { error: 'PIN must be at least 4 characters.' });
                    if (readDm() && readDm().pinHash) return send(409, { error: 'Already configured' });
                    const salt = crypto.randomBytes(16).toString('hex');
                    writeDm({ pinHash: hashPin(pin, salt), salt, notes: p.notes || '', updated: nowIsoSafe() });
                    return send(200, { ok: true });
                }
                if (urlPath === '/api/dm-notes/unlock') {
                    if (!pinValid(p.pin)) {
                        noteFailure(ip);
                        return send(401, { error: 'Incorrect PIN.' });
                    }
                    clearFailures(ip);
                    const dm = readDm();
                    return send(200, { notes: (dm && dm.notes) || '', updated: dm && dm.updated });
                }
                if (urlPath === '/api/dm-notes/save') {
                    if (!pinValid(p.pin)) {
                        noteFailure(ip);
                        return send(401, { error: 'Incorrect PIN.' });
                    }
                    clearFailures(ip);
                    const dm = readDm() || {};
                    dm.notes = p.notes || '';
                    dm.updated = nowIsoSafe();
                    writeDm(dm);
                    return send(200, { ok: true, updated: dm.updated });
                }
                if (urlPath === '/api/dm-notes/change-pin') {
                    const next = String(p.newPin || '');
                    if (next.length < 4) return send(400, { error: 'PIN must be at least 4 characters.' });
                    if (!pinValid(p.pin)) {
                        noteFailure(ip);
                        return send(401, { error: 'Incorrect PIN.' });
                    }
                    clearFailures(ip);
                    const dm = readDm() || {};
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

        return json(res, 404, { error: 'Not found' });
}

function nowIsoSafe() {
    return new Date().toISOString();
}

async function serveStatic(req, res, urlPath) {
        let decoded;
        try {
            decoded = decodeURIComponent(urlPath);
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<h1>400 Bad Request</h1><p>Malformed URL.</p>', 'utf-8');
            return;
        }

        // Portable maps: /maps/<file> from DATA_DIR/maps (then ROOT/maps)
        if (decoded === '/maps' || decoded.startsWith('/maps/')) {
            const mapFile = resolveMapFile(decoded === '/maps' ? '/maps/' : decoded);
            if (!mapFile) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Bad map path');
                return;
            }
            const tryPaths = [
                mapFile,
                path.join(ROOT, 'maps', path.basename(mapFile)),
                path.join(ROOT, path.basename(mapFile)) // legacy host symlink / file at project root
            ];
            for (const p of tryPaths) {
                try {
                    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
                        const ext = path.extname(p).toLowerCase();
                        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
                        const content = fs.readFileSync(p);
                        res.writeHead(200, {
                            'Content-Type': contentType,
                            'Cache-Control': 'public, max-age=3600'
                        });
                        res.end(content);
                        return;
                    }
                } catch (e) { /* try next */ }
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Map not found. Place files in the maps volume or upload from the app.');
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
            || base === 'board.json'
            || base === 'access.json'
            || base.endsWith('.tmp')) {
            res.writeHead(403, { 'Content-Type': 'text/html' });
            res.end('<h1>403 Forbidden</h1>', 'utf-8');
            return;
        }

        // Block data dir trees (legacy root or games/*) but allow maps via /maps/ above
        const boardRoot = board.boardRoot();
        if (filePath === boardRoot || filePath.startsWith(boardRoot + path.sep)) {
            if (filePath.includes(path.sep + 'campaign' + path.sep)
                || filePath.includes(path.sep + 'games' + path.sep)
                || base === 'manifest.json'
                || base === 'sessions.json'
                || base === 'board.json'
                || base === 'access.json') {
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

        // If requesting a bare image name that lives only under maps/, redirect path
        const extTry = path.extname(filePath).toLowerCase();
        if (['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(extTry) && !fs.existsSync(filePath)) {
            const inMaps = path.join(mapsDir(), path.basename(filePath));
            if (fs.existsSync(inMaps)) {
                filePath = inMaps;
            }
        }

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
}

server.listen(PORT, '0.0.0.0', () => {
    console.log('==================================================');
    console.log('Beer Club Game Board');
    console.log(`Listening on 0.0.0.0:${PORT}`);
    console.log(`Board data: ${board.boardRoot()}`);
    console.log(`Maps dir:   ${mapsDir()}`);
    console.log(`Node:       ${process.version}`);
    try {
        const b = board.listGamesPublic();
        console.log(`Games: ${b.games.map(g => g.id).join(', ') || '(none)'}`);
    } catch (e) { /* ignore */ }
    console.log(`Keeping up to ${MAX_BACKUPS} monolith backups per game.`);
    console.log('==================================================');
});

