/**
 * Versioned multi-file campaign store (middle path).
 * Characters / map / meta per campaign; combat global to active table for v1.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 2;
const CLAIM_TTL_MS = 15 * 60 * 1000;
const MAX_OFFERS = 5;
const MAX_BACKUPS = 30;

function dataRoot() {
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

function newId() {
    return crypto.randomBytes(16).toString('hex');
}

function nowIso() {
    return new Date().toISOString();
}

/* ---------- paths ---------- */

function manifestPath() {
    return path.join(dataRoot(), 'manifest.json');
}

function sessionsPath() {
    return path.join(dataRoot(), 'sessions.json');
}

function campaignDir(campaignId) {
    return path.join(dataRoot(), 'campaign', safeId(campaignId));
}

function metaPath(campaignId) {
    return path.join(campaignDir(campaignId), 'meta.json');
}

function mapPath(campaignId) {
    return path.join(campaignDir(campaignId), 'map.json');
}

function combatPath(campaignId) {
    return path.join(campaignDir(campaignId), 'combat.json');
}

function characterPath(campaignId, charId) {
    return path.join(campaignDir(campaignId), 'characters', safeId(charId) + '.json');
}

function monolithPath() {
    return path.join(dataRoot(), 'campaign_state.json');
}

function safeId(id) {
    return String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
}

/* ---------- doc helpers ---------- */

function emptyDoc(data, extra = {}) {
    return {
        revision: 1,
        updatedAt: nowIso(),
        ...extra,
        data: data == null ? {} : data
    };
}

function readDoc(filePath) {
    return readJson(filePath, null);
}

function writeDoc(filePath, doc) {
    atomicWriteJson(filePath, doc);
}

function bumpWrite(filePath, mutator) {
    const doc = readDoc(filePath);
    if (!doc) return { error: 'not_found', status: 404 };
    const result = mutator(doc);
    if (result && result.error) return result;
    doc.revision = (doc.revision || 0) + 1;
    doc.updatedAt = nowIso();
    writeDoc(filePath, doc);
    return { ok: true, doc };
}

/* ---------- sessions ---------- */

function readSessions() {
    const s = readJson(sessionsPath(), { sessions: {} });
    if (!s.sessions) s.sessions = {};
    return s;
}

function writeSessions(s) {
    atomicWriteJson(sessionsPath(), s);
}

function getSession(token) {
    if (!token) return null;
    const all = readSessions();
    const sess = all.sessions[token];
    if (!sess) return null;
    return { token, ...sess };
}

function touchSession(token) {
    const all = readSessions();
    if (!all.sessions[token]) return null;
    all.sessions[token].lastSeen = nowIso();
    writeSessions(all);
    return { token, ...all.sessions[token] };
}

function createSession(payload) {
    const all = readSessions();
    const token = newId();
    all.sessions[token] = {
        role: payload.role,
        characterId: payload.characterId || null,
        campaignId: payload.campaignId || null,
        label: payload.label || '',
        createdAt: nowIso(),
        lastSeen: nowIso()
    };
    writeSessions(all);
    return { token, ...all.sessions[token] };
}

function releaseSession(token) {
    const all = readSessions();
    const sess = all.sessions[token];
    if (!sess) return false;
    if (sess.role === 'player' && sess.characterId && sess.campaignId) {
        clearClaimIfHolder(sess.campaignId, sess.characterId, token);
    }
    delete all.sessions[token];
    writeSessions(all);
    return true;
}

function pruneSessions() {
    const all = readSessions();
    const cutoff = Date.now() - CLAIM_TTL_MS;
    let changed = false;
    for (const [token, sess] of Object.entries(all.sessions)) {
        const last = Date.parse(sess.lastSeen || sess.createdAt || 0);
        if (last < cutoff) {
            if (sess.role === 'player' && sess.characterId && sess.campaignId) {
                clearClaimIfHolder(sess.campaignId, sess.characterId, token);
            }
            delete all.sessions[token];
            changed = true;
        }
    }
    if (changed) writeSessions(all);
}

/* ---------- claims ---------- */

function clearClaimIfHolder(campaignId, charId, sessionId) {
    const p = characterPath(campaignId, charId);
    const doc = readDoc(p);
    if (!doc || !doc.claim) return;
    if (doc.claim.sessionId === sessionId) {
        doc.claim = null;
        doc.updatedAt = nowIso();
        writeDoc(p, doc);
    }
}

function expireStaleClaims(campaignId) {
    const dir = path.join(campaignDir(campaignId), 'characters');
    if (!fs.existsSync(dir)) return;
    const cutoff = Date.now() - CLAIM_TTL_MS;
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const p = path.join(dir, f);
        const doc = readDoc(p);
        if (!doc || !doc.claim || !doc.claim.lastSeen) continue;
        if (Date.parse(doc.claim.lastSeen) < cutoff) {
            doc.claim = null;
            doc.updatedAt = nowIso();
            writeDoc(p, doc);
        }
    }
}

/* ---------- manifest / layout ---------- */

function hasSplitLayout() {
    return fs.existsSync(manifestPath());
}

function readManifest() {
    return readJson(manifestPath(), null);
}

function listCharacterIds(campaignId) {
    const dir = path.join(campaignDir(campaignId), 'characters');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/, ''));
}

/* ---------- diff summary ---------- */

function summarizeDiff(before, after) {
    const lines = [];
    if (!before || !after) {
        lines.push('Full sheet update');
        return lines;
    }
    try {
        if (before.hp || after.hp) {
            const b = before.hp || {};
            const a = after.hp || {};
            if (b.current !== a.current) lines.push(`HP ${b.current} → ${a.current}`);
            if (b.max !== a.max) lines.push(`HP max ${b.max} → ${a.max}`);
            if (b.temp !== a.temp) lines.push(`Temp HP ${b.temp} → ${a.temp}`);
        }
        if (before.ac !== after.ac) lines.push(`AC ${before.ac} → ${after.ac}`);
        if (before.equipment !== after.equipment) lines.push('Equipment updated');
        if (before.notes !== after.notes) lines.push('Notes updated');
        if (JSON.stringify(before.spellSlots) !== JSON.stringify(after.spellSlots)) {
            lines.push('Spell slots updated');
        }
        if (JSON.stringify(before.resources) !== JSON.stringify(after.resources)) {
            lines.push('Resources updated');
        }
        if (JSON.stringify(before.conditions) !== JSON.stringify(after.conditions)) {
            lines.push('Conditions updated');
        }
        if (before.level !== after.level) lines.push(`Level ${before.level} → ${after.level}`);
        if (lines.length === 0) {
            if (JSON.stringify(before) !== JSON.stringify(after)) {
                lines.push('Character sheet updated');
            } else {
                lines.push('No visible field changes');
            }
        }
    } catch (e) {
        lines.push('Character sheet updated');
    }
    return lines.slice(0, 12);
}

/* ---------- write campaign from monolith-shaped state ---------- */

function backupMonolithIfPresent() {
    const target = monolithPath();
    if (!fs.existsSync(target)) return;
    const dir = dataRoot();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(dir, `campaign_state.pre-split-backup-${stamp}.json`);
    try {
        fs.copyFileSync(target, backup);
    } catch (e) {
        console.warn('pre-split backup failed:', e.message);
    }
}

function writeSplitFromState(state) {
    ensureDir(dataRoot());
    const campaigns = state.campaigns || [];
    if (!campaigns.length) {
        throw new Error('no campaigns');
    }

    // rolling backup of prior monolith if still there
    if (fs.existsSync(monolithPath())) {
        const dir = dataRoot();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        try {
            fs.copyFileSync(monolithPath(), path.join(dir, `campaign_state.backup-${stamp}.json`));
            const olds = fs.readdirSync(dir)
                .filter(f => f.startsWith('campaign_state.backup-') && f.endsWith('.json'))
                .sort();
            while (olds.length > MAX_BACKUPS) {
                fs.unlinkSync(path.join(dir, olds.shift()));
            }
        } catch (e) { /* best effort */ }
    }

    const manifest = {
        schemaVersion: SCHEMA_VERSION,
        activeCampaignId: state.activeCampaignId || campaigns[0].id,
        campaigns: campaigns.map(c => ({ id: c.id, name: c.name })),
        updatedAt: nowIso()
    };

    for (const camp of campaigns) {
        const cid = camp.id;
        ensureDir(path.join(campaignDir(cid), 'characters'));

        const metaDoc = emptyDoc({
            id: camp.id,
            name: camp.name,
            mapImage: camp.mapImage || '',
            sessionLogs: camp.sessionLogs || []
        });
        // preserve revision if exists
        const prevMeta = readDoc(metaPath(cid));
        if (prevMeta) {
            metaDoc.revision = (prevMeta.revision || 0) + 1;
        }
        writeDoc(metaPath(cid), metaDoc);

        const mapDoc = emptyDoc({
            mapMarkers: camp.mapMarkers || [],
            partyPosition: camp.partyPosition || { x: 350, y: 480 }
        });
        const prevMap = readDoc(mapPath(cid));
        if (prevMap) mapDoc.revision = (prevMap.revision || 0) + 1;
        writeDoc(mapPath(cid), mapDoc);

        const combatDoc = emptyDoc({
            combatants: state.combatants || [],
            activeCombatantIndex: state.activeCombatantIndex || 0,
            combatRound: state.combatRound || 1,
            rollHistory: state.rollHistory || []
        });
        // store combat once under active campaign for multi-campaign simplicity:
        // each campaign gets a copy of current combat blob when full state is written
        const prevCombat = readDoc(combatPath(cid));
        if (prevCombat) combatDoc.revision = (prevCombat.revision || 0) + 1;
        writeDoc(combatPath(cid), combatDoc);

        const chars = camp.characters || {};
        for (const [charId, data] of Object.entries(chars)) {
            const prev = readDoc(characterPath(cid, charId));
            const doc = {
                revision: prev ? (prev.revision || 0) + 1 : 1,
                updatedAt: nowIso(),
                claim: prev ? prev.claim : null,
                dmEditLock: prev ? prev.dmEditLock : null,
                pendingOffers: prev ? (prev.pendingOffers || []) : [],
                lastDmForce: prev ? prev.lastDmForce : null,
                data
            };
            writeDoc(characterPath(cid, charId), doc);
        }
    }

    atomicWriteJson(manifestPath(), manifest);
    return manifest;
}

function migrateIfNeeded() {
    ensureDir(dataRoot());
    if (hasSplitLayout()) return { migrated: false, reason: 'already_split' };

    const mono = readJson(monolithPath(), null);
    if (!mono || !Array.isArray(mono.campaigns) || !mono.campaigns.length) {
        return { migrated: false, reason: 'no_monolith' };
    }

    backupMonolithIfPresent();
    writeSplitFromState(mono);
    console.log('[store] Migrated campaign_state.json → split layout (schema v' + SCHEMA_VERSION + ')');
    return { migrated: true };
}

/* ---------- snapshot ---------- */

function buildSnapshot(campaignIdFilter) {
    if (!hasSplitLayout()) return null;

    pruneSessions();
    const manifest = readManifest();
    if (!manifest) return null;

    const activeId = campaignIdFilter || manifest.activeCampaignId || (manifest.campaigns[0] && manifest.campaigns[0].id);
    expireStaleClaims(activeId);

    const campaigns = [];
    const revisions = {};
    const locks = {};
    const claims = {};
    const offers = {};
    const dmForces = {};

    for (const entry of manifest.campaigns || []) {
        const cid = entry.id;
        const meta = readDoc(metaPath(cid));
        const map = readDoc(mapPath(cid));
        const combat = readDoc(combatPath(cid));
        if (!meta) continue;

        const characters = {};
        for (const charId of listCharacterIds(cid)) {
            const cdoc = readDoc(characterPath(cid, charId));
            if (!cdoc) continue;
            characters[charId] = cdoc.data;
            revisions['character:' + cid + ':' + charId] = cdoc.revision || 1;
            if (cid === activeId) {
                if (cdoc.dmEditLock) locks[charId] = cdoc.dmEditLock;
                if (cdoc.claim) claims[charId] = cdoc.claim;
                if (cdoc.pendingOffers && cdoc.pendingOffers.length) {
                    offers[charId] = cdoc.pendingOffers.map(o => ({
                        id: o.id,
                        fromLabel: o.fromLabel,
                        createdAt: o.createdAt,
                        summary: o.summary,
                        baseRevision: o.baseRevision
                    }));
                }
                if (cdoc.lastDmForce && !cdoc.lastDmForce.seenByHolder) {
                    dmForces[charId] = cdoc.lastDmForce;
                }
            }
        }

        revisions['meta:' + cid] = meta.revision || 1;
        revisions['map:' + cid] = (map && map.revision) || 1;
        revisions['combat:' + cid] = (combat && combat.revision) || 1;

        campaigns.push({
            id: meta.data.id || cid,
            name: meta.data.name || entry.name || cid,
            mapImage: meta.data.mapImage || '',
            characters,
            sessionLogs: meta.data.sessionLogs || [],
            mapMarkers: (map && map.data && map.data.mapMarkers) || [],
            partyPosition: (map && map.data && map.data.partyPosition) || { x: 350, y: 480 }
        });
    }

    const activeCombat = readDoc(combatPath(activeId));
    const combatData = (activeCombat && activeCombat.data) || {};

    return {
        schemaVersion: SCHEMA_VERSION,
        campaigns,
        activeCampaignId: activeId,
        combatants: combatData.combatants || [],
        activeCombatantIndex: combatData.activeCombatantIndex || 0,
        combatRound: combatData.combatRound || 1,
        rollHistory: combatData.rollHistory || [],
        revisions,
        locks,
        dmEditLocks: locks,
        claims,
        offers,
        dmForces
    };
}

/* ---------- entry ---------- */

function buildEntry() {
    migrateIfNeeded();
    if (!hasSplitLayout()) {
        return {
            ready: false,
            campaignName: 'Beer Club D&D',
            mapImage: 'phandelver-map-exterior-player.webp',
            characters: [],
            message: 'No campaign initialized yet. Open as DM after first setup, or load defaults from the app.'
        };
    }
    const snap = buildSnapshot();
    if (!snap || !snap.campaigns.length) {
        return { ready: false, campaignName: 'Beer Club D&D', mapImage: '', characters: [], message: 'Empty campaign' };
    }
    const camp = snap.campaigns.find(c => c.id === snap.activeCampaignId) || snap.campaigns[0];
    expireStaleClaims(camp.id);
    const characters = Object.entries(camp.characters || {}).map(([id, data]) => {
        const cdoc = readDoc(characterPath(camp.id, id));
        const claim = cdoc && cdoc.claim;
        const stale = claim && Date.parse(claim.lastSeen || 0) < Date.now() - CLAIM_TTL_MS;
        return {
            id,
            name: (data && data.name) || id,
            player: (data && data.player) || '',
            class: (data && data.class) || '',
            level: (data && data.level) || '',
            claimed: !!(claim && !stale),
            claimLabel: claim && !stale ? (claim.label || 'Player') : null,
            dmLocked: !!(cdoc && cdoc.dmEditLock)
        };
    });
    return {
        ready: true,
        campaignId: camp.id,
        campaignName: camp.name,
        mapImage: camp.mapImage || 'phandelver-map-exterior-player.webp',
        characters
    };
}

/* ---------- seat claim ---------- */

function claimSeat({ campaignId, characterId, label, steal }) {
    pruneSessions();
    expireStaleClaims(campaignId);
    const p = characterPath(campaignId, characterId);
    const doc = readDoc(p);
    if (!doc) return { status: 404, error: 'Character not found' };

    if (doc.claim && doc.claim.sessionId) {
        const last = Date.parse(doc.claim.lastSeen || 0);
        const alive = last >= Date.now() - CLAIM_TTL_MS;
        if (alive && !steal) {
            return {
                status: 409,
                error: 'Character seat is already claimed',
                claim: doc.claim
            };
        }
    }

    const sess = createSession({
        role: 'player',
        characterId,
        campaignId,
        label: label || characterId
    });

    doc.claim = {
        sessionId: sess.token,
        label: sess.label,
        claimedAt: nowIso(),
        lastSeen: nowIso()
    };
    // New holder: drop old offers aimed at previous holder
    doc.pendingOffers = [];
    doc.updatedAt = nowIso();
    writeDoc(p, doc);

    return {
        status: 200,
        sessionToken: sess.token,
        role: 'player',
        characterId,
        campaignId,
        label: sess.label
    };
}

function claimDmSeat({ label }) {
    const manifest = readManifest();
    const campaignId = (manifest && manifest.activeCampaignId) || null;
    const sess = createSession({
        role: 'dm',
        characterId: null,
        campaignId,
        label: label || 'DM'
    });
    return {
        status: 200,
        sessionToken: sess.token,
        role: 'dm',
        campaignId,
        label: sess.label
    };
}

function heartbeat(token) {
    const sess = touchSession(token);
    if (!sess) return { status: 401, error: 'Invalid session' };
    if (sess.role === 'player' && sess.characterId && sess.campaignId) {
        const p = characterPath(sess.campaignId, sess.characterId);
        const doc = readDoc(p);
        if (doc && doc.claim && doc.claim.sessionId === token) {
            doc.claim.lastSeen = nowIso();
            writeDoc(p, doc);
        }
    }
    return { status: 200, ok: true, session: { role: sess.role, characterId: sess.characterId, campaignId: sess.campaignId } };
}

/* ---------- character put ---------- */

function putCharacter(campaignId, charId, { baseRevision, data, sessionToken }) {
    const p = characterPath(campaignId, charId);
    const doc = readDoc(p);
    if (!doc) return { status: 404, error: 'Character not found' };

    if (typeof baseRevision !== 'number' || baseRevision !== doc.revision) {
        return {
            status: 409,
            error: 'Revision conflict',
            currentRevision: doc.revision,
            current: { revision: doc.revision, data: doc.data, claim: doc.claim }
        };
    }

    const sess = getSession(sessionToken);
    const isDm = sess && sess.role === 'dm';
    const isHolder = sess && doc.claim && doc.claim.sessionId === sessionToken;

    if (doc.dmEditLock && !isDm) {
        return { status: 423, error: 'Character locked by DM for editing', lock: doc.dmEditLock };
    }

    // DM force apply
    if (isDm) {
        const summary = summarizeDiff(doc.data, data);
        doc.data = data;
        doc.lastDmForce = {
            at: nowIso(),
            summary,
            seenByHolder: false
        };
        doc.pendingOffers = [];
        doc.revision = (doc.revision || 0) + 1;
        doc.updatedAt = nowIso();
        writeDoc(p, doc);
        return { status: 200, revision: doc.revision, mode: 'dm_force', summary };
    }

    // Holder direct write
    if (isHolder) {
        doc.data = data;
        doc.revision = (doc.revision || 0) + 1;
        doc.updatedAt = nowIso();
        if (doc.claim) doc.claim.lastSeen = nowIso();
        writeDoc(p, doc);
        return { status: 200, revision: doc.revision, mode: 'direct' };
    }

    // No claim — allow first-writer direct (table convenience)
    if (!doc.claim) {
        doc.data = data;
        doc.revision = (doc.revision || 0) + 1;
        doc.updatedAt = nowIso();
        writeDoc(p, doc);
        return { status: 200, revision: doc.revision, mode: 'direct_unclaimed' };
    }

    // Helper offer
    if (JSON.stringify(doc.data) === JSON.stringify(data)) {
        return { status: 200, revision: doc.revision, mode: 'noop' };
    }
    const summary = summarizeDiff(doc.data, data);
    if (summary.length === 1 && summary[0] === 'No visible field changes') {
        return { status: 200, revision: doc.revision, mode: 'noop' };
    }
    const offer = {
        id: newId(),
        fromSessionId: sessionToken || 'anonymous',
        fromLabel: (sess && sess.label) || 'Helper',
        createdAt: nowIso(),
        baseRevision: doc.revision,
        summary,
        proposedData: data
    };
    doc.pendingOffers = doc.pendingOffers || [];
    doc.pendingOffers.push(offer);
    while (doc.pendingOffers.length > MAX_OFFERS) doc.pendingOffers.shift();
    doc.updatedAt = nowIso();
    writeDoc(p, doc);
    return {
        status: 202,
        mode: 'offer',
        offerId: offer.id,
        summary: offer.summary
    };
}

function acceptOffer(campaignId, charId, offerId, sessionToken) {
    const p = characterPath(campaignId, charId);
    const doc = readDoc(p);
    if (!doc) return { status: 404, error: 'Character not found' };

    const sess = getSession(sessionToken);
    const isDm = sess && sess.role === 'dm';
    const isHolder = sess && doc.claim && doc.claim.sessionId === sessionToken;
    if (!isDm && !isHolder) {
        return { status: 403, error: 'Only the seat holder or DM can accept offers' };
    }

    const idx = (doc.pendingOffers || []).findIndex(o => o.id === offerId);
    if (idx < 0) return { status: 404, error: 'Offer not found' };
    const offer = doc.pendingOffers[idx];
    if (offer.baseRevision !== doc.revision) {
        return { status: 409, error: 'Offer is outdated; helper should resubmit', currentRevision: doc.revision };
    }
    doc.data = offer.proposedData;
    doc.pendingOffers.splice(idx, 1);
    doc.revision = (doc.revision || 0) + 1;
    doc.updatedAt = nowIso();
    writeDoc(p, doc);
    return { status: 200, revision: doc.revision, summary: offer.summary };
}

function denyOffer(campaignId, charId, offerId, sessionToken) {
    const p = characterPath(campaignId, charId);
    const doc = readDoc(p);
    if (!doc) return { status: 404, error: 'Character not found' };

    const sess = getSession(sessionToken);
    const isDm = sess && sess.role === 'dm';
    const isHolder = sess && doc.claim && doc.claim.sessionId === sessionToken;
    if (!isDm && !isHolder) {
        return { status: 403, error: 'Only the seat holder or DM can deny offers' };
    }

    const before = (doc.pendingOffers || []).length;
    doc.pendingOffers = (doc.pendingOffers || []).filter(o => o.id !== offerId);
    if (doc.pendingOffers.length === before) return { status: 404, error: 'Offer not found' };
    doc.updatedAt = nowIso();
    writeDoc(p, doc);
    return { status: 200, ok: true };
}

function ackDmForce(campaignId, charId, sessionToken) {
    const p = characterPath(campaignId, charId);
    const doc = readDoc(p);
    if (!doc) return { status: 404, error: 'Character not found' };
    const sess = getSession(sessionToken);
    const isHolder = sess && doc.claim && doc.claim.sessionId === sessionToken;
    const isDm = sess && sess.role === 'dm';
    if (!isHolder && !isDm) return { status: 403, error: 'Forbidden' };
    if (doc.lastDmForce) {
        doc.lastDmForce.seenByHolder = true;
        doc.updatedAt = nowIso();
        writeDoc(p, doc);
    }
    return { status: 200, ok: true };
}

function setDmEditLock(campaignId, charId, lock, note) {
    const p = characterPath(campaignId, charId);
    const doc = readDoc(p);
    if (!doc) return { status: 404, error: 'Character not found' };
    doc.dmEditLock = lock ? { at: nowIso(), note: note || '' } : null;
    doc.updatedAt = nowIso();
    writeDoc(p, doc);
    return { status: 200, dmEditLock: doc.dmEditLock };
}

/* ---------- piece puts: combat / map / meta ---------- */

function putPiece(filePath, baseRevision, data) {
    const doc = readDoc(filePath);
    if (!doc) return { status: 404, error: 'Not found' };
    if (typeof baseRevision !== 'number' || baseRevision !== doc.revision) {
        return { status: 409, error: 'Revision conflict', currentRevision: doc.revision, data: doc.data };
    }
    doc.data = data;
    doc.revision = (doc.revision || 0) + 1;
    doc.updatedAt = nowIso();
    writeDoc(filePath, doc);
    return { status: 200, revision: doc.revision };
}

function putCombat(campaignId, baseRevision, data) {
    return putPiece(combatPath(campaignId), baseRevision, data);
}

function putMap(campaignId, baseRevision, data) {
    return putPiece(mapPath(campaignId), baseRevision, data);
}

function putMeta(campaignId, baseRevision, data) {
    return putPiece(metaPath(campaignId), baseRevision, data);
}

function getActiveCampaignId() {
    const m = readManifest();
    return (m && m.activeCampaignId) || null;
}

function setActiveCampaignId(id) {
    const m = readManifest();
    if (!m) return;
    m.activeCampaignId = id;
    m.updatedAt = nowIso();
    atomicWriteJson(manifestPath(), m);
}

module.exports = {
    SCHEMA_VERSION,
    dataRoot,
    migrateIfNeeded,
    hasSplitLayout,
    writeSplitFromState,
    buildSnapshot,
    buildEntry,
    claimSeat,
    claimDmSeat,
    heartbeat,
    releaseSession,
    getSession,
    putCharacter,
    acceptOffer,
    denyOffer,
    ackDmForce,
    setDmEditLock,
    putCombat,
    putMap,
    putMeta,
    getActiveCampaignId,
    setActiveCampaignId,
    monolithPath,
    characterPath,
    combatPath,
    mapPath,
    metaPath,
    readDoc,
    listCharacterIds
};
