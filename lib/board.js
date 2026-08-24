/**
 * Beer Club Game Board — multi-game registry + table access PIN.
 * Each game lives under DATA_DIR/games/<gameId>/ (campaign store root).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BOARD_SCHEMA = 1;
const ACCESS_TTL_MS = 12 * 60 * 60 * 1000; // 12h table session
const MAX_PIN_FAIL = 5;
const PIN_LOCK_MS = 30000;

/** @type {Map<string, { gameId: string, exp: number }>} */
const accessSessions = new Map();
/** @type {Map<string, { count: number, last: number }>} */
const pinFailures = new Map();

function boardRoot() {
    return process.env.DATA_DIR
        ? path.resolve(process.env.DATA_DIR)
        : path.resolve(__dirname, '..');
}

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function atomicWriteJson(filePath, obj) {
    ensureDir(path.dirname(filePath));
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
}

function readJson(filePath, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        if (e.code === 'ENOENT') return fallback;
        throw e;
    }
}

function boardPath() {
    return path.join(boardRoot(), 'board.json');
}

function gamesDir() {
    return path.join(boardRoot(), 'games');
}

function gameRoot(gameId) {
    return path.join(gamesDir(), String(gameId));
}

function accessPath(gameId) {
    return path.join(gameRoot(gameId), 'access.json');
}

function hashPin(pin, salt) {
    return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}

function newToken() {
    return crypto.randomBytes(24).toString('hex');
}

function nowIso() {
    return new Date().toISOString();
}

function defaultBoard() {
    return {
        schemaVersion: BOARD_SCHEMA,
        title: 'Beer Club Game Board',
        games: [
            {
                id: 'lmop',
                name: 'Lost Mine of Phandelver',
                system: 'dnd5e',
                systemLabel: 'D&D',
                template: 'dnd5e',
                createdAt: nowIso()
            }
        ],
        updatedAt: nowIso()
    };
}

function isLegacyRootLayout() {
    const root = boardRoot();
    const hasRootData =
        fs.existsSync(path.join(root, 'manifest.json')) ||
        fs.existsSync(path.join(root, 'campaign_state.json')) ||
        fs.existsSync(path.join(root, 'campaign'));
    if (!hasRootData) return false;
    // Also treat as legacy if games/lmop has no real campaign data yet
    const lmopManifest = path.join(gameRoot('lmop'), 'manifest.json');
    if (!fs.existsSync(path.join(root, 'games'))) return true;
    try {
        const m = readJson(lmopManifest, null);
        const empty = !m || !Array.isArray(m.campaigns) || m.campaigns.length === 0;
        const rootM = readJson(path.join(root, 'manifest.json'), null);
        const rootHasCamps = rootM && Array.isArray(rootM.campaigns) && rootM.campaigns.length > 0;
        return empty && rootHasCamps;
    } catch (e) {
        return true;
    }
}

/**
 * Move pre-board DATA_DIR contents into games/lmop so live LMoP data is preserved.
 */
function migrateLegacyIntoLmop() {
    const root = boardRoot();
    const dest = gameRoot('lmop');
    ensureDir(dest);

    const skip = new Set(['games', 'board.json']);
    const names = fs.readdirSync(root);
    for (const name of names) {
        if (skip.has(name)) continue;
        const from = path.join(root, name);
        const to = path.join(dest, name);
        try {
            if (fs.existsSync(to)) {
                // Prefer root data over empty skeleton for key files
                if (name === 'manifest.json' || name === 'campaign' || name === 'campaign_state.json' || name === 'dm_notes.json') {
                    const stTo = fs.statSync(to);
                    const stFrom = fs.statSync(from);
                    if (stTo.isFile() && stFrom.isFile()) {
                        // overwrite empty-ish dest
                        const destJson = name.endsWith('.json') ? readJson(to, null) : null;
                        if (name === 'manifest.json' && destJson && Array.isArray(destJson.campaigns) && destJson.campaigns.length === 0) {
                            fs.copyFileSync(from, to);
                            fs.unlinkSync(from);
                            continue;
                        }
                    }
                    if (stTo.isDirectory() && name === 'campaign') {
                        // merge: if dest campaign empty of children, replace
                        const destKids = fs.readdirSync(to);
                        if (!destKids.length) {
                            fs.rmSync(to, { recursive: true, force: true });
                            fs.renameSync(from, to);
                            continue;
                        }
                    }
                }
                continue;
            }
            fs.renameSync(from, to);
        } catch (e) {
            try {
                const st = fs.statSync(from);
                if (st.isDirectory()) {
                    fs.cpSync(from, to, { recursive: true });
                    fs.rmSync(from, { recursive: true, force: true });
                } else {
                    fs.copyFileSync(from, to);
                    fs.unlinkSync(from);
                }
            } catch (e2) {
                console.warn('[board] migrate skip', name, e2.message);
            }
        }
    }

    // Ensure leftover root campaign/manifest moved if still present
    for (const name of ['manifest.json', 'sessions.json', 'dm_notes.json', 'campaign_state.json', 'campaign']) {
        const from = path.join(root, name);
        const to = path.join(dest, name);
        if (fs.existsSync(from) && !fs.existsSync(to)) {
            try {
                fs.renameSync(from, to);
            } catch (e) {
                console.warn('[board] second-pass move failed', name, e.message);
            }
        } else if (fs.existsSync(from) && fs.existsSync(to) && name === 'manifest.json') {
            const destM = readJson(to, null);
            const srcM = readJson(from, null);
            if (srcM && srcM.campaigns && srcM.campaigns.length && (!destM || !destM.campaigns || !destM.campaigns.length)) {
                fs.copyFileSync(from, to);
            }
            try { fs.unlinkSync(from); } catch (e) { /* ignore */ }
        } else if (fs.existsSync(from) && fs.existsSync(to) && name === 'campaign') {
            // if dest empty, replace
            try {
                if (!fs.readdirSync(to).length) {
                    fs.rmSync(to, { recursive: true, force: true });
                    fs.renameSync(from, to);
                }
            } catch (e) { /* ignore */ }
        }
    }

    atomicWriteJson(boardPath(), defaultBoard());
    console.log('[board] Migrated legacy DATA_DIR → games/lmop + board.json');
}

function ensureBlankGameSkeleton(gameId, meta) {
    const root = gameRoot(gameId);
    ensureDir(root);
    const manifestPath = path.join(root, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        atomicWriteJson(manifestPath, {
            schemaVersion: 2,
            activeCampaignId: null,
            campaigns: [],
            updatedAt: nowIso(),
            template: (meta && meta.template) || 'dnd5e'
        });
    }
    if (!fs.existsSync(path.join(root, 'sessions.json'))) {
        atomicWriteJson(path.join(root, 'sessions.json'), { sessions: {} });
    }
}

function ensureReady() {
    ensureDir(boardRoot());
    ensureDir(gamesDir());

    if (isLegacyRootLayout()) {
        migrateLegacyIntoLmop();
    }

    let board = readJson(boardPath(), null);
    if (!board || !Array.isArray(board.games)) {
        board = defaultBoard();
        atomicWriteJson(boardPath(), board);
    }

    for (const g of board.games) {
        ensureBlankGameSkeleton(g.id, g);
    }

    return board;
}

function readBoard() {
    ensureReady();
    return readJson(boardPath(), defaultBoard());
}

function listGamesPublic() {
    const board = readBoard();
    return {
        title: board.title || 'Beer Club Game Board',
        games: (board.games || []).map(g => {
            const access = readJson(accessPath(g.id), null);
            const pinConfigured = !!(access && access.pinHash);
            const manifest = readJson(path.join(gameRoot(g.id), 'manifest.json'), null);
            const campCount = (manifest && manifest.campaigns && manifest.campaigns.length) || 0;
            return {
                id: g.id,
                name: g.name,
                system: g.system || 'dnd5e',
                systemLabel: g.systemLabel || 'D&D',
                template: g.template || 'dnd5e',
                pinConfigured,
                pinRequired: true,
                needsPinSetup: !pinConfigured,
                campaignCount: campCount,
                label: g.name + ' (' + (g.systemLabel || 'D&D') + ')'
            };
        })
    };
}

function getGameMeta(gameId) {
    const board = readBoard();
    return (board.games || []).find(g => g.id === gameId) || null;
}

function throttledPin(ip) {
    const f = pinFailures.get(ip);
    if (!f || f.count < MAX_PIN_FAIL) return 0;
    const waitMs = PIN_LOCK_MS - (Date.now() - f.last);
    return waitMs > 0 ? Math.ceil(waitMs / 1000) : 0;
}

function notePinFail(ip) {
    const f = pinFailures.get(ip) || { count: 0, last: 0 };
    f.count++;
    f.last = Date.now();
    pinFailures.set(ip, f);
}

function clearPinFail(ip) {
    pinFailures.delete(ip);
}

function setupGamePin(gameId, pin, ip) {
    const meta = getGameMeta(gameId);
    if (!meta) return { status: 404, error: 'Unknown game' };
    if (!pin || String(pin).length < 4) {
        return { status: 400, error: 'PIN must be at least 4 characters' };
    }
    const existing = readJson(accessPath(gameId), null);
    if (existing && existing.pinHash) {
        return { status: 409, error: 'Game PIN already configured. Unlock with existing PIN.' };
    }
    const wait = throttledPin(ip || 'unknown');
    if (wait > 0) return { status: 429, error: `Too many attempts. Try again in ${wait}s.` };

    const salt = crypto.randomBytes(16).toString('hex');
    const pinHash = hashPin(pin, salt);
    atomicWriteJson(accessPath(gameId), {
        pinHash,
        salt,
        createdAt: nowIso(),
        updatedAt: nowIso()
    });
    clearPinFail(ip || 'unknown');
    return issueAccessToken(gameId);
}

function unlockGame(gameId, pin, ip) {
    const meta = getGameMeta(gameId);
    if (!meta) return { status: 404, error: 'Unknown game' };

    const wait = throttledPin(ip || 'unknown');
    if (wait > 0) return { status: 429, error: `Too many attempts. Try again in ${wait}s.` };

    const access = readJson(accessPath(gameId), null);
    if (!access || !access.pinHash) {
        return {
            status: 428,
            error: 'Game table PIN not set yet. Choose a PIN to protect this table (first-time setup).',
            needsPinSetup: true,
            gameId,
            gameName: meta.name
        };
    }

    try {
        const attempt = Buffer.from(hashPin(pin, access.salt), 'hex');
        const stored = Buffer.from(access.pinHash, 'hex');
        if (attempt.length !== stored.length || !crypto.timingSafeEqual(attempt, stored)) {
            notePinFail(ip || 'unknown');
            return { status: 401, error: 'Incorrect game PIN.' };
        }
    } catch (e) {
        notePinFail(ip || 'unknown');
        return { status: 401, error: 'Incorrect game PIN.' };
    }

    clearPinFail(ip || 'unknown');
    return issueAccessToken(gameId);
}

function issueAccessToken(gameId) {
    const meta = getGameMeta(gameId);
    const token = newToken();
    const exp = Date.now() + ACCESS_TTL_MS;
    accessSessions.set(token, { gameId, exp });
    // prune occasionally
    if (accessSessions.size > 200) {
        const now = Date.now();
        for (const [k, v] of accessSessions) {
            if (v.exp < now) accessSessions.delete(k);
        }
    }
    return {
        status: 200,
        gameAccessToken: token,
        gameId,
        gameName: meta ? meta.name : gameId,
        system: meta ? meta.system : 'dnd5e',
        systemLabel: meta ? meta.systemLabel : 'D&D',
        expiresAt: new Date(exp).toISOString()
    };
}

function resolveAccessToken(token) {
    if (!token) return null;
    const s = accessSessions.get(token);
    if (!s) return null;
    if (s.exp < Date.now()) {
        accessSessions.delete(token);
        return null;
    }
    return s;
}

function revokeAccessToken(token) {
    if (token) accessSessions.delete(token);
}

/**
 * Blank D&D table payload (no characters, no map, empty campaigns).
 * Used when initializing a fresh game root with no migrated data.
 */
function blankDndSharedState() {
    return {
        campaigns: [],
        activeCampaignId: '',
        combatants: [],
        activeCombatantIndex: 0,
        combatRound: 1,
        rollHistory: []
    };
}

module.exports = {
    BOARD_SCHEMA,
    boardRoot,
    gameRoot,
    ensureReady,
    listGamesPublic,
    getGameMeta,
    setupGamePin,
    unlockGame,
    resolveAccessToken,
    revokeAccessToken,
    blankDndSharedState,
    readBoard
};
