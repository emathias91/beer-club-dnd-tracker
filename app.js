// D&D Campaign Dashboard Core Controller (Multi-Campaign Version)

// Global App State
let state = {
    campaigns: [],
    activeCampaignId: '',
    activeCharacterId: null,
    zoomLevel: 1.0,
    isAddingMarker: false,
    combatants: [],
    activeCombatantIndex: 0,
    combatRound: 1,
    rollHistory: [],
    revisions: {},
    locks: {},
    claims: {},
    offers: {},
    dmForces: {}
};

// Local-only UI (never authoritative on server)
const LOCAL_UI_KEY = 'dnd_local_ui';
function loadLocalUi() {
    try {
        const u = JSON.parse(localStorage.getItem(LOCAL_UI_KEY) || '{}');
        if (u.activeCharacterId) state.activeCharacterId = u.activeCharacterId;
        if (typeof u.zoomLevel === 'number') state.zoomLevel = u.zoomLevel;
    } catch (e) { /* ignore */ }
}
function saveLocalUi() {
    try {
        localStorage.setItem(LOCAL_UI_KEY, JSON.stringify({
            activeCharacterId: state.activeCharacterId,
            zoomLevel: state.zoomLevel
        }));
    } catch (e) { /* ignore */ }
}

function setSyncStatus(text, level) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.textContent = text;
    el.dataset.level = level || 'ok';
}

function sessionHeaders() {
    if (window.SeatSession) return SeatSession.headers();
    if (window.GameAccess) return GameAccess.headers();
    return { 'Content-Type': 'application/json' };
}

// Web Audio API Sound Synthesizer for rolling dice
let audioCtx = null;
function playDiceSound() {
    if (!document.getElementById('dice-sound-toggle').checked) return;
    
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Play multiple tiny friction clicks to simulate rolling dice
        const now = audioCtx.currentTime;
        
        // Roll friction sound (rumble)
        const rumbleOsc = audioCtx.createOscillator();
        const rumbleGain = audioCtx.createGain();
        rumbleOsc.type = 'triangle';
        rumbleOsc.frequency.setValueAtTime(80, now);
        rumbleOsc.frequency.exponentialRampToValueAtTime(30, now + 0.5);
        
        rumbleGain.gain.setValueAtTime(0.3, now);
        rumbleGain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        
        rumbleOsc.connect(rumbleGain);
        rumbleGain.connect(audioCtx.destination);
        rumbleOsc.start(now);
        rumbleOsc.stop(now + 0.5);
        
        // Dynamic impact clicks (4-5 clicks spaced out)
        const clickTimes = [0.1, 0.22, 0.35, 0.44, 0.52];
        clickTimes.forEach((time, index) => {
            const clickOsc = audioCtx.createOscillator();
            const clickGain = audioCtx.createGain();
            clickOsc.type = 'sine';
            const freq = index === clickTimes.length - 1 ? 400 : 250 + Math.random() * 100;
            
            clickOsc.frequency.setValueAtTime(freq, now + time);
            clickOsc.frequency.exponentialRampToValueAtTime(10, now + time + 0.08);
            
            clickGain.gain.setValueAtTime(0.15 - (index * 0.02), now + time);
            clickGain.gain.exponentialRampToValueAtTime(0.001, now + time + 0.08);
            
            clickOsc.connect(clickGain);
            clickGain.connect(audioCtx.destination);
            clickOsc.start(now + time);
            clickOsc.stop(now + time + 0.08);
        });
    } catch (e) {
        console.warn('Audio Context failed to start:', e);
    }
}

// ----------------------------------------------------
// Campaign Getters
// ----------------------------------------------------
function getActiveCampaign() {
    if (state.campaigns.length === 0) return null;
    return state.campaigns.find(c => c.id === state.activeCampaignId) || state.campaigns[0];
}

// ----------------------------------------------------
// Collaborative Sync & Core Initialization
// ----------------------------------------------------
const IS_SERVER_MODE = window.location.protocol.startsWith('http');

let appBooted = false;

window.bootCampaignApp = async function bootCampaignApp() {
    if (appBooted) {
        await loadState();
        renderCampaignSelector();
        renderAll();
        applySeatFocus();
        processSeatNotices();
        return;
    }
    appBooted = true;
    loadLocalUi();
    await loadState();
    initNavigation();
    initMapPanel();
    initCharacterPanel();
    initPlayerNotesUi();
    initEquipmentInventory();
    initSkillsPanel();
    initCombatPanel();
    initSessionLogsPanel();
    initModals();
    initImportExport();
    initCampaignSettings();
    initRestButtons();
    initDmPanel();
    initSeatChrome();
    renderCampaignSelector();
    renderAll();
    applySeatFocus();
    startPollingSync();
    processSeatNotices();
    setSyncStatus('Live', 'ok');
};

function applySeatFocus() {
    if (!window.SeatSession) return;
    const seat = SeatSession.get();
    if (!seat) return;
    if (seat.role === 'player' && seat.characterId) {
        state.activeCharacterId = seat.characterId;
        saveLocalUi();
        const badge = document.getElementById('seat-badge');
        if (badge) {
            badge.style.display = 'block';
            badge.textContent = 'Playing: ' + seat.characterId + (seat.label ? ' (' + seat.label + ')' : '');
        }
    } else if (seat.role === 'dm') {
        const badge = document.getElementById('seat-badge');
        if (badge) {
            badge.style.display = 'block';
            badge.textContent = 'DM seat' + (seat.label ? ' — ' + seat.label : '');
        }
        updateCharSheetChrome();
    }
    updateAdminToolsChrome();
}

function initSeatChrome() {
    const leave = document.getElementById('btn-leave-seat');
    if (leave) {
        leave.addEventListener('click', () => {
            if (window.leaveSeatAndReturn) leaveSeatAndReturn();
        });
    }
    const leaveGame = document.getElementById('btn-leave-game');
    if (leaveGame) {
        leaveGame.addEventListener('click', () => {
            if (window.leaveGameAndReturn) leaveGameAndReturn();
        });
    }
    const lockBtn = document.getElementById('btn-dm-char-lock');
    const unlockBtn = document.getElementById('btn-dm-char-unlock');
    if (lockBtn) {
        lockBtn.addEventListener('click', () => dmToggleCharLock(true));
    }
    if (unlockBtn) {
        unlockBtn.addEventListener('click', () => dmToggleCharLock(false));
    }
    updateCharSheetChrome();
    updateAdminToolsChrome();
}

/** DM tools + lock banner live on the Characters panel (self-contained). */
function updateCharSheetChrome() {
    const tools = document.getElementById('char-dm-tools');
    const statusEl = document.getElementById('char-sheet-status');
    const lockBtn = document.getElementById('btn-dm-char-lock');
    const unlockBtn = document.getElementById('btn-dm-char-unlock');
    const editBtn = document.getElementById('btn-edit-char-modal');
    const isDm = !!(window.SeatSession && SeatSession.isDm());
    if (tools) tools.style.display = isDm ? 'flex' : 'none';

    const camp = typeof getActiveCampaign === 'function' ? getActiveCampaign() : null;
    const charId = state.activeCharacterId;
    const locks =
        (state.dmEditLocks && state.dmEditLocks[charId]) ||
        (state.locks && state.locks[charId]) ||
        null;
    const locked = !!(locks && locks.at);
    const name = (camp && camp.characters && camp.characters[charId] && camp.characters[charId].name) || charId || 'Character';

    if (statusEl) {
        if (locked) {
            statusEl.style.display = 'block';
            statusEl.className = 'char-sheet-status is-locked';
            statusEl.innerHTML = '<i class="fa-solid fa-lock"></i> <strong>' +
                escapeHtml(name) + '</strong> is locked for DM corrections' +
                (locks.note ? ' — ' + escapeHtml(locks.note) : '');
        } else if (isDm && charId) {
            statusEl.style.display = 'block';
            statusEl.className = 'char-sheet-status is-open';
            statusEl.innerHTML = '<i class="fa-solid fa-lock-open"></i> Working on <strong>' +
                escapeHtml(name) + '</strong> — lock this sheet to block other saves while you edit';
        } else {
            statusEl.style.display = 'none';
            statusEl.textContent = '';
        }
    }

    if (lockBtn) {
        lockBtn.disabled = !isDm || !charId || locked;
        lockBtn.title = locked
            ? 'This sheet is already locked'
            : 'Lock ' + (name || 'this sheet') + ' so only DM can save it';
    }
    if (unlockBtn) {
        unlockBtn.disabled = !isDm || !charId || !locked;
        unlockBtn.title = locked
            ? 'Unlock ' + (name || 'this sheet') + ' so the player can save again'
            : 'Sheet is not locked';
    }

    // DM: Edit Character Specs only after Lock This Sheet (greyed until locked).
    // Players keep edit when a character is selected (their normal sheet edits).
    if (editBtn) {
        if (isDm) {
            editBtn.disabled = !charId || !locked;
            editBtn.title = !charId
                ? 'Select a character'
                : locked
                    ? 'Edit specs while this sheet is DM-locked'
                    : 'Lock This Sheet first, then edit character specs';
        } else {
            editBtn.disabled = !charId;
            editBtn.title = charId ? 'Edit character specs' : 'Select a character';
        }
    }
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function dmToggleCharLock(lock) {
    if (!window.SeatSession || !SeatSession.isDm()) {
        alert('DM seat required.');
        return;
    }
    const camp = getActiveCampaign();
    if (!camp || !state.activeCharacterId) return;
    const path = '/api/characters/' + encodeURIComponent(camp.id) + '/' +
        encodeURIComponent(state.activeCharacterId) + (lock ? '/dm-lock' : '/dm-unlock');
    try {
        const res = await fetch(path, {
            method: 'POST',
            headers: sessionHeaders(),
            body: JSON.stringify({ note: lock ? 'DM corrections' : '' })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Lock failed');
            return;
        }
        // Keep chrome in sync even before full reload
        if (!state.dmEditLocks) state.dmEditLocks = {};
        if (!state.locks) state.locks = {};
        const id = state.activeCharacterId;
        if (lock) {
            const entry = data.dmEditLock || { at: new Date().toISOString(), note: 'DM corrections' };
            state.dmEditLocks[id] = entry;
            state.locks[id] = entry;
        } else {
            delete state.dmEditLocks[id];
            delete state.locks[id];
        }
        updateCharSheetChrome();
        setSyncStatus(lock ? 'Character DM-locked' : 'Character unlocked', 'ok');
        await loadState();
        renderAll();
        updateCharSheetChrome();
    } catch (e) {
        alert('Network error');
    }
}

// Load state from server or localStorage fallback
function applyServerSnapshot(fetchedState) {
    const keepChar = state.activeCharacterId;
    const keepZoom = state.zoomLevel;
    // Preserve local private fields if server omitted them (non-owner strip) but we still own the seat
    const privateKeep = {};
    (state.campaigns || []).forEach(camp => {
        Object.keys(camp.characters || {}).forEach(charId => {
            if (!canEditPlayerPrivate(charId)) return;
            const c = camp.characters[charId];
            if (!c) return;
            privateKeep[camp.id + ':' + charId] = {
                playerNotes: c.playerNotes,
                playerPassphrase: c.playerPassphrase
            };
        });
    });

    // Hold local combat if we just changed it and server may still be stale
    const holdCombat = Date.now() < (_suppressCombatSyncUntil || 0);
    const localCombat = holdCombat
        ? {
            combatants: state.combatants,
            activeCombatantIndex: state.activeCombatantIndex,
            combatRound: state.combatRound,
            rollHistory: state.rollHistory
        }
        : null;

    state.campaigns = fetchedState.campaigns || [];
    // Re-apply preserved private fields when server snapshot omitted them for non-owners of OTHER devices
    (state.campaigns || []).forEach(camp => {
        Object.keys(camp.characters || {}).forEach(charId => {
            const key = camp.id + ':' + charId;
            const kept = privateKeep[key];
            if (!kept || !canEditPlayerPrivate(charId)) return;
            const c = camp.characters[charId];
            if (!c) return;
            if (c.playerNotes == null && kept.playerNotes != null) c.playerNotes = kept.playerNotes;
            if (c.playerPassphrase == null && kept.playerPassphrase != null) c.playerPassphrase = kept.playerPassphrase;
        });
    });
    if (!holdCombat) {
        state.combatants = fetchedState.combatants || [];
        state.activeCombatantIndex = typeof fetchedState.activeCombatantIndex === 'number'
            ? fetchedState.activeCombatantIndex
            : 0;
        state.combatRound = typeof fetchedState.combatRound === 'number'
            ? fetchedState.combatRound
            : 1;
        state.rollHistory = fetchedState.rollHistory || [];
    } else {
        state.combatants = localCombat.combatants;
        state.activeCombatantIndex = localCombat.activeCombatantIndex;
        state.combatRound = localCombat.combatRound;
        // Still take newer roll history from server if longer; prefer local if we just rolled
        if (!localCombat.rollHistory || !localCombat.rollHistory.length) {
            state.rollHistory = fetchedState.rollHistory || [];
        } else {
            state.rollHistory = localCombat.rollHistory;
        }
    }
    state.revisions = fetchedState.revisions || {};
    state.locks = fetchedState.locks || {};
    // UI chrome uses dmEditLocks; snapshot exposes the same map as "locks"
    state.dmEditLocks = fetchedState.dmEditLocks || fetchedState.locks || {};
    state.claims = fetchedState.claims || {};
    state.offers = fetchedState.offers || {};
    state.dmForces = fetchedState.dmForces || {};
    if (fetchedState.activeCampaignId) {
        state.activeCampaignId = fetchedState.activeCampaignId;
    }
    // restore local-only UI (tab selection is per-browser — do not force seat character on every poll)
    state.activeCharacterId = keepChar || state.activeCharacterId;
    state.zoomLevel = keepZoom;
    // Seat only sets the default tab at boot (applySeatFocus). Players may view other sheets
    // without losing their seat; poll must not yank the tab back.
    checkSeatClaimStillMine();
}

/** Ethan #3: if snapshot claims show another session holds our PC, kick to entry. */
function checkSeatClaimStillMine() {
    if (!window.SeatSession || typeof SeatSession.get !== 'function') return;
    const seat = SeatSession.get();
    if (!seat || seat.role !== 'player' || !seat.characterId || !seat.sessionToken) return;
    const claim = state.claims && state.claims[seat.characterId];
    if (!claim || !claim.sessionId) return; // expired / free — heartbeat will handle
    if (claim.sessionId !== seat.sessionToken) {
        if (typeof window.handleSeatTaken === 'function') {
            window.handleSeatTaken(
                'Your seat was taken by another device' +
                    (claim.label ? ' (' + claim.label + ')' : '') +
                    '. You are no longer logged in on this seat.'
            );
        }
    }
}

async function loadState() {
    if (IS_SERVER_MODE) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const hdrs = sessionHeaders();
            let response = await fetch('/api/snapshot', {
                signal: controller.signal,
                cache: 'no-store',
                headers: hdrs
            });
            if (response.status === 404) {
                response = await fetch('/api/state', {
                    signal: controller.signal,
                    cache: 'no-store',
                    headers: hdrs
                });
            }
            clearTimeout(timeoutId);

            if (response.status === 401) {
                setSyncStatus('Table locked', 'err');
                console.warn('loadState: game table auth required (X-Game-Token)');
                loadStateFromLocalStorage();
                return;
            }

            if (response.ok) {
                const fetchedState = await response.json();
                console.log('Loaded campaign state from server.');
                applyServerSnapshot(fetchedState);
                try {
                    localStorage.setItem('dnd_campaign_state', JSON.stringify({
                        campaigns: state.campaigns,
                        activeCampaignId: state.activeCampaignId,
                        combatants: state.combatants,
                        activeCombatantIndex: state.activeCombatantIndex,
                        combatRound: state.combatRound,
                        rollHistory: state.rollHistory
                    }));
                } catch (e) {}
                // Blank tables (campaigns: []) are a valid first-run state — do not
                // self-heal by POSTing defaults. resetToDefaults() is also empty now,
                // so heal + saveStateToServer() → loadState() would loop forever and
                // never finish boot (dead UI, backup rotation wiped in <1s).
                if (!state.activeCampaignId && state.campaigns[0]) {
                    state.activeCampaignId = state.campaigns[0].id;
                }
                setSyncStatus('Live', 'ok');
                return;
            } else if (response.status === 404) {
                // Only true "nothing initialized" case — seed blank template once.
                console.log('No state found on server. Initializing blank table.');
                await resetToDefaults({ persist: false });
                await saveStateToServer();
                return;
            } else {
                setSyncStatus('Server error', 'err');
            }
        } catch (e) {
            console.warn('Failed to load state from server, falling back to localStorage:', e);
            setSyncStatus('Offline', 'err');
        }
    }

    loadStateFromLocalStorage();
}

function loadStateFromLocalStorage() {
    try {
        const stored = localStorage.getItem('dnd_campaign_state');
        if (stored) {
            const parsed = JSON.parse(stored);
            
            // Migrate old single-campaign state if needed
            if (parsed.characters && !parsed.campaigns) {
                const oldCampaign = {
                    id: "phandelver",
                    name: "Lost Mine of Phandelver",
                    mapImage: "phandelver-map-exterior-player.webp",
                    characters: parsed.characters,
                    sessionLogs: parsed.sessionLogs || [],
                    mapMarkers: parsed.mapMarkers || [],
                    partyPosition: parsed.partyPosition || { x: 350, y: 480, lastUpdated: "Arrived in Phandalin" }
                };
                parsed.campaigns = [oldCampaign];
                parsed.activeCampaignId = "phandelver";
                delete parsed.characters;
                delete parsed.sessionLogs;
                delete parsed.mapMarkers;
                delete parsed.partyPosition;
            }
            
            // Apply parsed values
            state.campaigns = parsed.campaigns || [];
            state.activeCampaignId = parsed.activeCampaignId || '';
            state.activeCharacterId = parsed.activeCharacterId || null;
            state.zoomLevel = parsed.zoomLevel || 1.0;
            state.combatants = parsed.combatants || [];
            state.activeCombatantIndex = parsed.activeCombatantIndex || 0;
            state.combatRound = parsed.combatRound || 1;
            state.rollHistory = parsed.rollHistory || [];
        } else {
            resetToDefaults({ persist: false });
        }
        
        // Safety check
        if (!state.campaigns || state.campaigns.length === 0) {
            resetToDefaults({ persist: false });
        }
        if (!state.activeCampaignId) {
            state.activeCampaignId = state.campaigns[0].id;
        }
        if (!state.rollHistory) state.rollHistory = [];
    } catch (e) {
        console.error('Error loading state from localStorage, using defaults:', e);
        resetToDefaults({ persist: false });
    }
}

function saveState() {
    saveLocalUi();
    try {
        localStorage.setItem('dnd_campaign_state', JSON.stringify({
            campaigns: state.campaigns,
            activeCampaignId: state.activeCampaignId,
            combatants: state.combatants,
            activeCombatantIndex: state.activeCombatantIndex,
            combatRound: state.combatRound,
            rollHistory: state.rollHistory
        }));
    } catch (e) {
        console.error('Error saving state to localStorage:', e);
    }

    if (IS_SERVER_MODE) {
        // Debounced smart save: prefer piece endpoints when revisions known
        queueSmartSave();
    }
}

let _saveTimer = null;
let _saveInFlight = false;
function queueSmartSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => { smartSaveToServer(); }, 200);
}

async function saveStateToServer() {
    // Full snapshot write (init / import / reset / fallback)
    try {
        setSyncStatus('Saving…', 'warn');
        const payload = {
            campaigns: state.campaigns,
            activeCampaignId: state.activeCampaignId,
            combatants: state.combatants,
            activeCombatantIndex: state.activeCombatantIndex,
            combatRound: state.combatRound,
            rollHistory: state.rollHistory
        };
        const response = await fetch('/api/state', {
            method: 'POST',
            headers: sessionHeaders(),
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            console.error('Server failed to save campaign state:', response.statusText);
            setSyncStatus('Save failed', 'err');
            return false;
        }
        // refresh revisions
        await loadState();
        setSyncStatus('Saved', 'ok');
        return true;
    } catch (e) {
        console.error('Network error saving campaign state to server:', e);
        setSyncStatus('Offline', 'err');
        return false;
    }
}

async function smartSaveToServer() {
    if (_saveInFlight) return;
    _saveInFlight = true;
    try {
        const camp = getActiveCampaign();
        if (!camp) return;

        const seat = (window.SeatSession && SeatSession.get()) || null;
        const isPlayerSeat = !!(seat && seat.role === 'player' && seat.characterId);
        const isDmSeat = !!(seat && seat.role === 'dm');

        // Full monolith save bypasses offer flow — never use it for seated players.
        // DM / no-seat may full-save when revisions missing.
        if (!state.revisions || !Object.keys(state.revisions).length) {
            if (isPlayerSeat) {
                setSyncStatus('Syncing…', 'warn');
                await loadState();
                renderAll();
                setSyncStatus('Live', 'ok');
                return;
            }
            await saveStateToServer();
            return;
        }

        setSyncStatus('Saving…', 'warn');
        const cid = camp.id;

        // Characters: DM writes all; player writes claimed seat (+ offer path for other open sheet)
        let charIds = Object.keys(camp.characters || {});
        if (isPlayerSeat) {
            charIds = charIds.filter(id => id === seat.characterId);
        }

        for (const charId of charIds) {
            const revKey = 'character:' + cid + ':' + charId;
            let baseRevision = state.revisions[revKey];
            if (typeof baseRevision !== 'number') {
                if (isPlayerSeat) {
                    await loadState();
                    renderAll();
                    setSyncStatus('Live', 'ok');
                    return;
                }
                await saveStateToServer();
                return;
            }
            const res = await fetch(
                '/api/characters/' + encodeURIComponent(cid) + '/' + encodeURIComponent(charId),
                {
                    method: 'PUT',
                    headers: sessionHeaders(),
                    body: JSON.stringify({
                        baseRevision,
                        data: camp.characters[charId]
                    })
                }
            );
            const data = await res.json().catch(() => ({}));
            if (res.status === 409) {
                setSyncStatus('Conflict — reloading', 'err');
                await loadState();
                renderAll();
                processSeatNotices();
                return;
            }
            if (res.status === 423) {
                setSyncStatus('Locked by DM', 'warn');
                await loadState();
                renderAll();
                return;
            }
            if (res.status === 202) {
                setSyncStatus('Sent for approval', 'warn');
                showOfferPendingToast(data.summary);
                await loadState();
                // revert local non-owned? loadState already applied server truth for offers
                return;
            }
            if (!res.ok) {
                console.error('Character save failed', charId, data);
                if (isPlayerSeat) {
                    setSyncStatus('Save failed', 'err');
                    await loadState();
                    renderAll();
                    return;
                }
                await saveStateToServer();
                return;
            }
            if (typeof data.revision === 'number') {
                state.revisions[revKey] = data.revision;
            }
        }

        // Helper: player edited a different character tab → offer only (never full overwrite)
        if (isPlayerSeat && state.activeCharacterId &&
            state.activeCharacterId !== seat.characterId &&
            camp.characters[state.activeCharacterId]) {
            const charId = state.activeCharacterId;
            const revKey = 'character:' + cid + ':' + charId;
            const baseRevision = state.revisions[revKey];
            if (typeof baseRevision === 'number') {
                const res = await fetch(
                    '/api/characters/' + encodeURIComponent(cid) + '/' + encodeURIComponent(charId),
                    {
                        method: 'PUT',
                        headers: sessionHeaders(),
                        body: JSON.stringify({
                            baseRevision,
                            data: camp.characters[charId]
                        })
                    }
                );
                const data = await res.json().catch(() => ({}));
                if (res.status === 202) {
                    setSyncStatus('Sent for approval', 'warn');
                    showOfferPendingToast(data.summary);
                    // Reload so helper's local sheet reverts to server truth until accepted
                    await loadState();
                    renderAll();
                    return;
                }
                if (res.status === 409) {
                    setSyncStatus('Conflict — reloading', 'err');
                    await loadState();
                    renderAll();
                    return;
                }
                if (res.status === 423) {
                    setSyncStatus('Locked by DM', 'warn');
                    await loadState();
                    renderAll();
                    return;
                }
                if (res.ok && data.mode === 'noop') {
                    setSyncStatus('Live', 'ok');
                } else if (res.ok && typeof data.revision === 'number') {
                    // Should not direct-apply for helpers after server fix; still reload if it did
                    if (data.mode && String(data.mode).startsWith('direct')) {
                        console.warn('Unexpected direct save on helper edit', data.mode);
                    }
                    state.revisions[revKey] = data.revision;
                    await loadState();
                    renderAll();
                } else if (!res.ok) {
                    setSyncStatus('Save failed', 'err');
                    await loadState();
                    renderAll();
                    return;
                }
            } else {
                setSyncStatus('Syncing…', 'warn');
                await loadState();
                renderAll();
                return;
            }
        }

        // Map / meta / combat: players may still update shared table state (existing policy)
        // Map
        {
            const revKey = 'map:' + cid;
            const baseRevision = state.revisions[revKey];
            if (typeof baseRevision === 'number') {
                const res = await fetch('/api/map/' + encodeURIComponent(cid), {
                    method: 'PUT',
                    headers: sessionHeaders(),
                    body: JSON.stringify({
                        baseRevision,
                        data: {
                            mapMarkers: camp.mapMarkers || [],
                            partyPosition: camp.partyPosition
                        }
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (res.status === 409) {
                    setSyncStatus('Map conflict — reloading', 'err');
                    await loadState();
                    renderAll();
                    return;
                }
                if (res.ok && typeof data.revision === 'number') {
                    state.revisions[revKey] = data.revision;
                } else if (!res.ok) {
                    if (isPlayerSeat) {
                        setSyncStatus('Save failed', 'err');
                        return;
                    }
                    await saveStateToServer();
                    return;
                }
            }
        }

        // Meta (name, mapImage, logs)
        {
            const revKey = 'meta:' + cid;
            const baseRevision = state.revisions[revKey];
            if (typeof baseRevision === 'number') {
                const res = await fetch('/api/meta/' + encodeURIComponent(cid), {
                    method: 'PUT',
                    headers: sessionHeaders(),
                    body: JSON.stringify({
                        baseRevision,
                        data: {
                            id: camp.id,
                            name: camp.name,
                            mapImage: camp.mapImage,
                            sessionLogs: camp.sessionLogs || []
                        }
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (res.status === 409) {
                    setSyncStatus('Meta conflict — reloading', 'err');
                    await loadState();
                    renderAll();
                    return;
                }
                if (res.ok && typeof data.revision === 'number') {
                    state.revisions[revKey] = data.revision;
                } else if (!res.ok) {
                    if (isPlayerSeat) {
                        setSyncStatus('Save failed', 'err');
                        return;
                    }
                    await saveStateToServer();
                    return;
                }
            }
        }

        // Combat
        {
            const revKey = 'combat:' + cid;
            const baseRevision = state.revisions[revKey];
            if (typeof baseRevision === 'number') {
                const res = await fetch('/api/combat/' + encodeURIComponent(cid), {
                    method: 'PUT',
                    headers: sessionHeaders(),
                    body: JSON.stringify({
                        baseRevision,
                        data: {
                            combatants: state.combatants,
                            activeCombatantIndex: state.activeCombatantIndex,
                            combatRound: state.combatRound,
                            rollHistory: state.rollHistory
                        }
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (res.status === 409) {
                    setSyncStatus('Combat conflict — reloading', 'err');
                    await loadState();
                    renderAll();
                    return;
                }
                if (res.ok && typeof data.revision === 'number') {
                    state.revisions[revKey] = data.revision;
                } else if (!res.ok) {
                    if (isPlayerSeat) {
                        setSyncStatus('Save failed', 'err');
                        return;
                    }
                    await saveStateToServer();
                    return;
                }
            }
        }

        setSyncStatus('Saved', 'ok');
    } catch (e) {
        console.error(e);
        setSyncStatus('Offline', 'err');
    } finally {
        _saveInFlight = false;
    }
}

function showOfferPendingToast(summary) {
    const lines = (summary || []).join('\n• ');
    console.log('Offer pending approval', summary);
    // lightweight non-blocking note
    const el = document.getElementById('offer-toast');
    if (el) {
        el.style.display = 'block';
        el.textContent = 'Change sent to seat holder for approval' +
            (lines ? ': ' + (summary || []).join('; ') : '');
        setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
}

let _noticeBusy = false;
const _suppressedDmForce = new Set();
const _suppressedOffers = new Set();
async function processSeatNotices() {
    if (_noticeBusy) return;
    if (!window.SeatSession) return;
    const seat = SeatSession.get();
    if (!seat || seat.role !== 'player' || !seat.characterId) {
        return;
    }
    const charId = seat.characterId;

    const force = state.dmForces && state.dmForces[charId];
    if (force && !force.seenByHolder && !_suppressedDmForce.has(force.at + charId)) {
        _noticeBusy = true;
        try {
            const summary = (force.summary || []).join('\n• ');
            const msg = 'DM changed ' + charId +
                (summary ? ':\n• ' + summary : '') +
                '\n\nReload sheet to see updates.';
            if (confirm(msg + '\n\nOK = Reload now')) {
                const camp = getActiveCampaign();
                if (camp) {
                    await fetch(
                        '/api/characters/' + encodeURIComponent(camp.id) + '/' +
                        encodeURIComponent(charId) + '/ack-dm-force',
                        { method: 'POST', headers: sessionHeaders(), body: '{}' }
                    );
                }
                await loadState();
                renderAll();
            } else {
                _suppressedDmForce.add(force.at + charId);
            }
        } finally {
            _noticeBusy = false;
        }
        return;
    }

    const offers = (state.offers && state.offers[charId]) || [];
    if (!offers.length) return;
    const offer = offers[0];
    if (_suppressedOffers.has(offer.id)) return;
    _noticeBusy = true;
    try {
        const summary = (offer.summary || []).join('\n• ');
        const accept = confirm(
            charId + ' was modified' +
            (offer.fromLabel ? ' by ' + offer.fromLabel : '') +
            (summary ? ':\n• ' + summary : '') +
            '\n\nOK = Accept   Cancel = Deny'
        );
        const camp = getActiveCampaign();
        if (!camp) return;
        const base = '/api/characters/' + encodeURIComponent(camp.id) + '/' +
            encodeURIComponent(charId) + '/offers/' + encodeURIComponent(offer.id) +
            (accept ? '/accept' : '/deny');
        const res = await fetch(base, {
            method: 'POST',
            headers: sessionHeaders(),
            body: '{}'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            alert(data.error || 'Could not resolve offer');
            _suppressedOffers.add(offer.id);
        }
        await loadState();
        renderAll();
        setTimeout(() => { _noticeBusy = false; processSeatNotices(); }, 100);
        return;
    } catch (e) {
        console.error(e);
    } finally {
        _noticeBusy = false;
    }
}

function isModalOpen() {
    const overlays = document.querySelectorAll('.modal-overlay');
    for (let overlay of overlays) {
        if (window.getComputedStyle(overlay).display === 'flex' || overlay.style.display === 'flex') {
            return true;
        }
    }
    return false;
}

function isUserEditing() {
    const active = document.activeElement;
    if (active) {
        const tagName = active.tagName.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || active.isContentEditable) {
            return true;
        }
    }
    return isModalOpen();
}

function isSharedStateEqual(a, b) {
    if (!a || !b) return false;
    try {
        const sharedA = {
            campaigns: a.campaigns,
            combatants: a.combatants,
            activeCombatantIndex: a.activeCombatantIndex,
            combatRound: a.combatRound,
            rollHistory: a.rollHistory
        };
        const sharedB = {
            campaigns: b.campaigns,
            combatants: b.combatants,
            activeCombatantIndex: b.activeCombatantIndex,
            combatRound: b.combatRound,
            rollHistory: b.rollHistory
        };
        return JSON.stringify(sharedA) === JSON.stringify(sharedB);
    } catch (e) {
        return false;
    }
}

function startPollingSync() {
    if (!IS_SERVER_MODE) return;

    setInterval(async () => {
        try {
            const response = await fetch('/api/snapshot', {
                cache: 'no-store',
                headers: sessionHeaders()
            });
            if (response.ok) {
                const fetchedState = await response.json();
                if (!isSharedStateEqual(state, fetchedState)) {
                    if (!isUserEditing()) {
                        applyServerSnapshot(fetchedState);
                        try {
                            localStorage.setItem('dnd_campaign_state', JSON.stringify({
                                campaigns: state.campaigns,
                                activeCampaignId: state.activeCampaignId,
                                combatants: state.combatants,
                                activeCombatantIndex: state.activeCombatantIndex,
                                combatRound: state.combatRound,
                                rollHistory: state.rollHistory
                            }));
                        } catch (e) {}
                        renderCampaignSelector();
                        renderAll();
                        processSeatNotices();
                        setSyncStatus('Live', 'ok');
                        console.log('Campaign state synchronized from server.');
                    } else {
                        console.log('Campaign sync deferred because user is actively typing or editing a modal.');
                    }
                } else {
                    // still merge offers/dmForces/revisions
                    state.revisions = fetchedState.revisions || state.revisions;
                    state.offers = fetchedState.offers || {};
                    state.dmForces = fetchedState.dmForces || {};
                    state.locks = fetchedState.locks || {};
                    state.dmEditLocks = fetchedState.dmEditLocks || fetchedState.locks || state.dmEditLocks;
                    state.claims = fetchedState.claims || {};
                    processSeatNotices();
                    checkSeatClaimStillMine();
                    setSyncStatus('Live', 'ok');
                }
            } else if (response.status === 401) {
                setSyncStatus('Table locked', 'err');
            } else {
                setSyncStatus('Server error', 'err');
            }
        } catch (e) {
            console.warn('Error during background state sync polling:', e);
            setSyncStatus('Offline', 'err');
        }
    }, 3000);
}

function resetToDefaults(opts) {
    const persist = !opts || opts.persist !== false;
    // Blank D&D template — no seed party, map, logs, or combat
    state.campaigns = [];
    state.activeCampaignId = '';
    state.activeCharacterId = null;
    state.zoomLevel = 1.0;
    state.combatants = [];
    state.activeCombatantIndex = 0;
    state.combatRound = 1;
    state.rollHistory = [];
    state.revisions = {};
    state.locks = {};
    state.dmEditLocks = {};
    state.offers = [];
    state.claims = {};
    saveLocalUi();
    try {
        localStorage.setItem('dnd_campaign_state', JSON.stringify(buildSharedExportPayload()));
    } catch (e) {
        console.error('Error saving state to localStorage:', e);
    }
    if (persist && IS_SERVER_MODE) {
        return saveStateToServer();
    }
    return Promise.resolve(true);
}

function initDefaultCombatants(chars) {
    return Object.keys(chars || {}).map(key => {
        const c = chars[key] || {};
        const hpObj = c.hp && typeof c.hp === 'object' ? c.hp : null;
        let hp = null;
        let maxHp = null;
        if (hpObj) {
            if (typeof hpObj.current === 'number') hp = hpObj.current;
            if (typeof hpObj.max === 'number') maxHp = hpObj.max;
            if (hp == null && maxHp != null) hp = maxHp;
        } else if (typeof c.hp === 'number') {
            hp = c.hp;
            maxHp = c.hp;
        }
        return {
            name: c.name || key,
            characterId: key,
            initiative: 0,
            hp,
            maxHp,
            isMonster: false
        };
    });
}

/** Party PCs for combat tracker helpers. */
function partyCharactersForCombat() {
    const active = getActiveCampaign();
    if (!active || !active.characters) return [];
    return Object.keys(active.characters).map(id => {
        const c = active.characters[id] || {};
        const hpObj = c.hp && typeof c.hp === 'object' ? c.hp : null;
        let hp = null;
        let maxHp = null;
        if (hpObj) {
            if (typeof hpObj.current === 'number') hp = hpObj.current;
            if (typeof hpObj.max === 'number') maxHp = hpObj.max;
            if (hp == null && maxHp != null) hp = maxHp;
        } else if (typeof c.hp === 'number') {
            hp = c.hp;
            maxHp = c.hp;
        }
        return {
            id,
            name: String(c.name || id || 'Character').trim(),
            hp,
            maxHp
        };
    }).filter(p => p.name);
}

function combatantMatchesParty(cb, charId, name) {
    if (!cb || cb.isMonster) return false;
    if (charId && cb.characterId && String(cb.characterId) === String(charId)) return true;
    const n = String(name || '').trim().toLowerCase();
    const cn = String(cb.name || '').trim().toLowerCase();
    return !!(n && cn && n === cn);
}

function isPartyMemberInCombat(charId, name) {
    return (state.combatants || []).some(cb => combatantMatchesParty(cb, charId, name));
}

/** Parse optional number fields; blank / ?? → null. */
function parseOptionalCombatNumber(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s || s === '??' || s === '?' || s.toLowerCase() === 'unknown') return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
}

function formatCombatHpDisplay(v) {
    return (v == null || v === '') ? '??' : String(v);
}

function combatInitSortValue(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function buildCombatantFromParty(p, opts) {
    const initiative = opts && Object.prototype.hasOwnProperty.call(opts, 'initiative')
        ? opts.initiative
        : null;
    return {
        name: p.name,
        characterId: p.id,
        initiative: initiative == null || initiative === '' ? null : combatInitSortValue(initiative),
        hp: p.hp == null ? null : p.hp,
        maxHp: p.maxHp == null ? null : p.maxHp,
        isMonster: false
    };
}

/**
 * Ensure every party character is on the tracker.
 * @param {{ zeroInit?: boolean, refreshHpFromSheet?: boolean }} opts
 */
function ensureAllPartyOnTracker(opts) {
    opts = opts || {};
    if (!Array.isArray(state.combatants)) state.combatants = [];
    const party = partyCharactersForCombat();
    party.forEach(p => {
        const existing = state.combatants.find(cb => combatantMatchesParty(cb, p.id, p.name));
        if (existing) {
            if (!existing.characterId) existing.characterId = p.id;
            if (existing.name !== p.name && p.name) existing.name = p.name;
            if (opts.refreshHpFromSheet) {
                existing.hp = p.hp == null ? null : p.hp;
                existing.maxHp = p.maxHp == null ? null : p.maxHp;
            }
            if (opts.zeroInit) existing.initiative = 0;
        } else {
            const row = buildCombatantFromParty(p, {
                initiative: opts.zeroInit ? 0 : null
            });
            state.combatants.push(row);
        }
    });
}

function renderPartyQuickAddList() {
    const host = document.getElementById('combat-party-quick-add');
    if (!host) return;
    const missing = partyCharactersForCombat().filter(p => !isPartyMemberInCombat(p.id, p.name));
    if (!missing.length) {
        const partyCount = partyCharactersForCombat().length;
        host.innerHTML = partyCount
            ? '<p class="entry-hint" style="margin:0;">All party characters are already on the tracker.</p>'
            : '<p class="entry-hint" style="margin:0;">No party characters in this campaign yet.</p>';
        return;
    }
    host.innerHTML =
        '<p class="entry-hint" style="margin:0 0 8px;">Party not on tracker — click to add (init optional; HP from sheet):</p>' +
        '<div class="combat-party-quick-btns"></div>';
    const wrap = host.querySelector('.combat-party-quick-btns');
    missing.forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-dnd combat-party-quick-btn';
        const hpLabel = (p.hp != null || p.maxHp != null)
            ? ('HP ' + formatCombatHpDisplay(p.hp) + (p.maxHp != null ? '/' + formatCombatHpDisplay(p.maxHp) : ''))
            : 'HP ??';
        btn.innerHTML =
            '<i class="fa-solid fa-user-plus"></i> ' +
            escapeHtml(p.name) +
            ' <span class="combat-party-quick-meta">(' + escapeHtml(hpLabel) + ')</span>';
        btn.addEventListener('click', () => {
            if (!requireDmAction('add combatants')) return;
            if (isPartyMemberInCombat(p.id, p.name)) {
                renderPartyQuickAddList();
                return;
            }
            state.combatants.push(buildCombatantFromParty(p, { initiative: null }));
            renderInitiativeList();
            saveCombatNow();
            renderPartyQuickAddList();
        });
        wrap.appendChild(btn);
    });
}

function openAddCombatantModal() {
    if (!requireDmAction('add combatants')) return;
    document.getElementById('init-name-input').value = '';
    document.getElementById('init-score-input').value = '';
    document.getElementById('init-hp-input').value = '';
    document.getElementById('init-is-monster').checked = false;
    renderPartyQuickAddList();
    document.getElementById('modal-add-combatant').style.display = 'flex';
}

// ----------------------------------------------------
// Navigation Controller
// ----------------------------------------------------
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));
            
            item.classList.add('active');
            const targetPanelId = item.getAttribute('data-target');
            const targetPanel = document.getElementById(targetPanelId);
            if (targetPanel) {
                targetPanel.classList.add('active');
            }
            
            if (targetPanelId === 'panel-map') {
                renderMapMarkers();
            } else if (targetPanelId === 'panel-characters') {
                renderCharacterTabs();
                renderSelectedCharacter();
            } else if (targetPanelId === 'panel-combat') {
                renderInitiativeList();
                renderRollHistory();
            } else if (targetPanelId === 'panel-logs') {
                renderSessionLogsList();
            }
        });
    });
}

// ----------------------------------------------------
// 1. Map Panel Controller & Drag-Drop Logic
// ----------------------------------------------------

/** Normalize campaign mapImage to a fetchable URL (maps volume preferred). */
function resolveCampaignMapUrl(mapImage) {
    const raw = String(mapImage || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
    if (raw.startsWith('/maps/')) return raw;
    // bare filename → try portable maps path first
    const base = raw.split(/[\\/]/).pop();
    if (base && /\.(webp|png|jpe?g|gif|svg)$/i.test(base)) {
        return '/maps/' + encodeURIComponent(base);
    }
    return raw;
}

function showMapMissing(show, message, reason) {
    const overlay = document.getElementById('map-missing-overlay');
    const status = document.getElementById('map-missing-status');
    const img = document.getElementById('map-image');
    if (overlay) overlay.style.display = show ? 'flex' : 'none';
    if (img) img.style.visibility = show ? 'hidden' : 'visible';
    if (status && message != null) status.textContent = message;
    if (overlay && reason) overlay.dataset.reason = reason;
    if (show) updateMapUploadChrome();
}

/** DM can upload / change map; players see read-only blank copy. */
function updateMapUploadChrome() {
    const isDm = canUseDestructiveAdmin();
    const overlay = document.getElementById('map-missing-overlay');
    const reason = (overlay && overlay.dataset.reason) || 'unset';
    const title = document.getElementById('map-missing-title');
    const body = document.getElementById('map-missing-body');
    const actions = document.getElementById('map-missing-actions');
    const browseBtn = document.getElementById('btn-browse-map');
    const changeBtn = document.getElementById('map-change-image');
    const mapInput = document.getElementById('campaign-map-input');
    const mapInputLabel = mapInput && mapInput.closest('label');

    if (reason === 'error') {
        if (title) title.textContent = 'Map file not found';
        if (body) {
            body.innerHTML = isDm
                ? 'The map file saved for this campaign could not be loaded. Confirm it exists in the <code>maps/</code> folder, or upload a replacement.'
                : 'The campaign map file is missing. Only the DM can fix this.';
        }
    } else {
        if (title) title.textContent = 'No map uploaded';
        if (body) {
            body.innerHTML = isDm
                ? 'Maps are not shipped in git (copyright). Place files in the <code>maps/</code> folder or upload one here.'
                : 'No map uploaded. Only the DM can upload a campaign map.';
        }
    }
    if (actions) actions.style.display = isDm ? '' : 'none';
    if (browseBtn) {
        browseBtn.style.display = isDm ? '' : 'none';
        browseBtn.disabled = !isDm;
        browseBtn.title = isDm ? 'Upload a campaign map image' : 'Only the DM can upload a map';
    }
    if (changeBtn) {
        changeBtn.style.display = isDm ? '' : 'none';
        changeBtn.disabled = !isDm;
        changeBtn.title = isDm ? 'Change map image' : 'Only the DM can change the map';
    }
    if (mapInput) {
        mapInput.disabled = !isDm;
        mapInput.readOnly = !isDm;
        mapInput.title = isDm
            ? 'Map path or /maps/… URL'
            : 'Only the DM can set the campaign map';
        if (mapInputLabel) mapInputLabel.style.opacity = isDm ? '' : '0.65';
    }
}

function bindMapImageLifecycle(mapImg) {
    if (!mapImg || mapImg.dataset.mapBound === '1') return;
    mapImg.dataset.mapBound = '1';
    mapImg.addEventListener('load', () => {
        if (mapImg.naturalWidth > 0) {
            showMapMissing(false, '');
        } else {
            const active = getActiveCampaign();
            const name = active && active.mapImage ? active.mapImage : '(none)';
            showMapMissing(true, 'Map file appears corrupted: ' + name, 'error');
        }
    });
    mapImg.addEventListener('error', () => {
        const active = getActiveCampaign();
        const name = active && active.mapImage ? active.mapImage : '(none)';
        showMapMissing(true, 'Could not load: ' + name, 'error');
    });
}

async function uploadMapFile(file) {
    if (!file) return null;
    if (!canUseDestructiveAdmin()) {
        throw new Error('Only the DM can upload a campaign map.');
    }
    const status = document.getElementById('map-missing-status');
    if (status) status.textContent = 'Uploading ' + file.name + '…';
    const buf = await file.arrayBuffer();
    // base64 without huge stack
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const dataBase64 = btoa(binary);
    const res = await fetch('/api/maps/upload', {
        method: 'POST',
        headers: sessionHeaders(),
        body: JSON.stringify({
            filename: file.name,
            dataBase64
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || ('Upload failed (' + res.status + ')'));
    }
    return data;
}

async function applyUploadedMap(uploadResult) {
    const active = getActiveCampaign();
    if (!active || !uploadResult || !uploadResult.url) return;
    active.mapImage = uploadResult.url;
    // force full meta write
    if (state.revisions) {
        // leave revisions; saveState smart path handles meta
    }
    await saveStateToServer();
    renderMapMarkers();
    showMapMissing(false, '');
    setSyncStatus('Map uploaded', 'ok');
}

function openMapFilePicker() {
    const input = document.getElementById('map-file-input');
    if (input) {
        input.value = '';
        input.click();
    }
}

function initMapPanel() {
    const container = document.getElementById('map-image-container');
    const token = document.getElementById('party-token');
    const mapImg = document.getElementById('map-image');
    bindMapImageLifecycle(mapImg);
    
    // Zooming Controls
    document.getElementById('map-zoom-in').addEventListener('click', () => {
        state.zoomLevel = Math.min(state.zoomLevel + 0.25, 3.0);
        applyZoom();
    });
    document.getElementById('map-zoom-out').addEventListener('click', () => {
        state.zoomLevel = Math.max(state.zoomLevel - 0.25, 0.5);
        applyZoom();
    });
    document.getElementById('map-zoom-reset').addEventListener('click', () => {
        state.zoomLevel = 1.0;
        applyZoom();
    });

    const openMapPicker = () => {
        if (!canUseDestructiveAdmin()) {
            alert('Only the DM can upload a campaign map.');
            return;
        }
        openMapFilePicker();
    };
    const changeBtn = document.getElementById('map-change-image');
    if (changeBtn) changeBtn.addEventListener('click', openMapPicker);
    const browseBtn = document.getElementById('btn-browse-map');
    if (browseBtn) browseBtn.addEventListener('click', openMapPicker);
    const fileInput = document.getElementById('map-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            try {
                const result = await uploadMapFile(file);
                await applyUploadedMap(result);
            } catch (e) {
                console.error(e);
                showMapMissing(true, e.message || 'Upload failed');
                alert(e.message || 'Map upload failed');
            }
        });
    }
    
    function applyZoom() {
        container.style.transform = `scale(${state.zoomLevel})`;
        saveLocalUi();
    }
    
    // Add Marker Mode Button
    const addMarkerBtn = document.getElementById('btn-add-marker-modal');
    addMarkerBtn.addEventListener('click', () => {
        state.isAddingMarker = true;
        addMarkerBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Click on the Map...';
        addMarkerBtn.classList.add('btn-dnd-success');
    });

    mapImg.addEventListener('click', (e) => {
        if (mapImg.style.visibility === 'hidden') return;
        const rect = mapImg.getBoundingClientRect();
        const scaleX = mapImg.naturalWidth / rect.width;
        const scaleY = mapImg.naturalHeight / rect.height;
        
        const clickX = Math.round((e.clientX - rect.left) * scaleX);
        const clickY = Math.round((e.clientY - rect.top) * scaleY);
        
        if (state.isAddingMarker) {
            state.isAddingMarker = false;
            addMarkerBtn.innerHTML = '<i class="fa-solid fa-map-pin"></i> Add Location Pin';
            addMarkerBtn.classList.remove('btn-dnd-success');
            
            openAddMarkerModal(clickX, clickY);
        } else {
            showMarkerDetails(null);
        }
    });

    // Draggable token
    let isDragging = false;
    let startX = 0, startY = 0;
    let tokenX = 0, tokenY = 0;
    
    token.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        const active = getActiveCampaign();
        tokenX = active.partyPosition.x;
        tokenY = active.partyPosition.y;
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        
        showPartyDetails();
    });
    
    function onMouseMove(e) {
        if (!isDragging) return;
        const active = getActiveCampaign();
        
        const dx = (e.clientX - startX) / state.zoomLevel;
        const dy = (e.clientY - startY) / state.zoomLevel;
        
        let newX = tokenX + dx;
        let newY = tokenY + dy;
        
        const maxW = mapImg.naturalWidth || 2000;
        const maxH = mapImg.naturalHeight || 2000;
        newX = Math.max(0, Math.min(maxW, newX));
        newY = Math.max(0, Math.min(maxH, newY));
        
        token.style.left = `${newX}px`;
        token.style.top = `${newY}px`;
        
        active.partyPosition.x = Math.round(newX);
        active.partyPosition.y = Math.round(newY);
    }
    
    function onMouseUp(e) {
        if (!isDragging) return;
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        
        saveState();
        showPartyDetails();
    }
    
    // Update party log button
    document.getElementById('btn-update-party-loc').addEventListener('click', () => {
        const active = getActiveCampaign();
        if (!active || !active.partyPosition) {
            alert('Create a campaign first.');
            return;
        }
        document.getElementById('party-location-input').value = active.partyPosition.lastUpdated || '';
        document.getElementById('modal-party-location').style.display = 'flex';
    });
    
    document.getElementById('btn-save-party-location').addEventListener('click', () => {
        const active = getActiveCampaign();
        if (!active || !active.partyPosition) return;
        const val = document.getElementById('party-location-input').value.trim();
        active.partyPosition.lastUpdated = val || "Active travel";
        saveState();
        showPartyDetails();
        document.getElementById('modal-party-location').style.display = 'none';
    });
}

function renderMapMarkers() {
    const active = getActiveCampaign();
    updateEmptyCampaignChrome();
    if (!active) {
        const layer = document.getElementById('map-markers-layer');
        if (layer) layer.innerHTML = '';
        const mapImg = document.getElementById('map-image');
        if (mapImg) {
            mapImg.removeAttribute('src');
            mapImg.removeAttribute('data-resolved');
        }
        const token = document.getElementById('party-token');
        if (token) {
            token.style.left = '100px';
            token.style.top = '100px';
        }
        return;
    }
    
    const layer = document.getElementById('map-markers-layer');
    layer.innerHTML = '';
    
    // Set map image src (portable /maps/… preferred)
    const mapImg = document.getElementById('map-image');
    bindMapImageLifecycle(mapImg);
    const url = resolveCampaignMapUrl(active.mapImage);
    if (!url) {
        mapImg.removeAttribute('src');
        showMapMissing(true, '', 'unset');
    } else {
        // Bust cache when switching maps
        const bust = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(url);
        if (mapImg.getAttribute('data-resolved') !== url) {
            mapImg.setAttribute('data-resolved', url);
            showMapMissing(false, 'Loading map…');
            mapImg.src = bust;
        } else if (mapImg.naturalWidth > 0) {
            showMapMissing(false, '');
        }
    }
    
    // Render location markers
    (active.mapMarkers || []).forEach(marker => {
        const pin = document.createElement('div');
        pin.className = `map-marker ${marker.type || 'town'}`;
        pin.style.left = `${marker.x}px`;
        pin.style.top = `${marker.y}px`;
        pin.setAttribute('data-id', marker.id);
        pin.title = marker.name;
        
        pin.addEventListener('click', (e) => {
            e.stopPropagation();
            showMarkerDetails(marker);
        });
        
        layer.appendChild(pin);
    });
    
    // Render party token position
    const token = document.getElementById('party-token');
    const pos = active.partyPosition || { x: 100, y: 100 };
    token.style.left = `${pos.x}px`;
    token.style.top = `${pos.y}px`;
    
    // Set map transform scale
    document.getElementById('map-image-container').style.transform = `scale(${state.zoomLevel})`;
}

function showMarkerDetails(marker) {
    const active = getActiveCampaign();
    const placeholder = document.getElementById('marker-details-placeholder');
    const content = document.getElementById('marker-content');
    const delBtn = document.getElementById('btn-delete-marker');
    
    if (!marker) {
        placeholder.style.display = 'flex';
        content.style.display = 'none';
        if (delBtn) delBtn.style.display = 'none';
        return;
    }
    
    placeholder.style.display = 'none';
    content.style.display = 'block';
    
    document.getElementById('marker-name').innerText = marker.name;
    document.getElementById('marker-description').innerText = marker.description || 'No notes.';
    
    const badge = document.getElementById('marker-type-badge');
    badge.innerText = marker.type || 'town';
    badge.className = `marker-badge ${marker.type || 'town'}`;
    
    // Edit stays available; Delete description/notes is DM-only
    document.getElementById('btn-edit-marker').onclick = () => {
        openEditMarkerModal(marker);
    };
    
    const isDm = canUseDestructiveAdmin();
    if (delBtn) {
        delBtn.style.display = isDm ? 'inline-flex' : 'none';
        delBtn.title = isDm
            ? 'Delete this location pin and its notes'
            : 'Only the DM can delete location notes';
        delBtn.onclick = () => {
            if (!requireDmAction('delete location notes')) return;
            if (confirm(`Are you sure you want to delete the marker for ${marker.name}?`)) {
                if (!active) return;
                active.mapMarkers = (active.mapMarkers || []).filter(m => m.id !== marker.id);
                saveState();
                renderMapMarkers();
                showMarkerDetails(null);
            }
        };
    }
}

function showPartyDetails() {
    const active = getActiveCampaign();
    const placeholder = document.getElementById('marker-details-placeholder');
    const content = document.getElementById('marker-content');
    
    placeholder.style.display = 'none';
    content.style.display = 'block';
    
    document.getElementById('marker-name').innerHTML = '<i class="fa-solid fa-shield-halved"></i> The Adventurers';
    document.getElementById('marker-description').innerText = `Current Location & Status: \n${active.partyPosition.lastUpdated}\n\nCoords: X:${active.partyPosition.x}, Y:${active.partyPosition.y}`;
    
    const badge = document.getElementById('marker-type-badge');
    badge.innerText = 'Party Token';
    badge.className = 'marker-badge landmark';
    
    document.getElementById('btn-edit-marker').onclick = () => {
        document.getElementById('party-location-input').value = active.partyPosition.lastUpdated;
        document.getElementById('modal-party-location').style.display = 'flex';
    };
    
    // Party token is not a deletable location note
    const delBtn = document.getElementById('btn-delete-marker');
    if (delBtn) {
        delBtn.style.display = 'none';
        delBtn.onclick = null;
    }
    
    document.getElementById('party-loc-desc').innerText = active.partyPosition.lastUpdated;
}

// ----------------------------------------------------
// 2. Character Sheet Controller & Level-up Logic
// ----------------------------------------------------

/**
 * HP color spectrum from current HP:
 * - Full HP → green
 * - Less than 5 HP remaining → red
 * - Smooth blend between full and the low-HP zone
 */
function hpHealthColor(current, max) {
    const maxHp = Math.max(1, Number(max) || 1);
    let cur = Number(current);
    if (!Number.isFinite(cur)) cur = 0;
    cur = Math.max(0, Math.min(cur, maxHp));

    if (cur <= 0) {
        return { color: 'hsl(0, 78%, 38%)', level: 'dead' };
    }
    if (cur >= maxHp) {
        return { color: 'hsl(132, 58%, 42%)', level: 'full' };
    }

    // Remaining HP < 5 is the red zone (critical)
    const criticalCap = Math.min(5, maxHp);
    let t; // 0 = worst red, 1 = just below full green
    if (cur < criticalCap) {
        // 0 .. criticalCap → deep red .. orange-red (0 .. ~0.22)
        t = (cur / criticalCap) * 0.22;
    } else {
        // criticalCap .. max → orange-red .. green (0.22 .. 1)
        t = 0.22 + 0.78 * ((cur - criticalCap) / (maxHp - criticalCap));
    }
    t = Math.max(0, Math.min(1, t));
    const hue = Math.round(120 * t); // 0 red → 120 green
    const sat = Math.round(72 - 12 * t);
    const light = Math.round(40 + 6 * t);
    let level = 'mid';
    if (cur < criticalCap) level = 'critical';
    else if (t > 0.75) level = 'high';
    else if (t < 0.4) level = 'low';
    return { color: `hsl(${hue}, ${sat}%, ${light}%)`, level };
}

function updateCharacterHpColor(current, max) {
    const curEl = document.getElementById('char-hp-current');
    const maxEl = document.getElementById('char-hp-max');
    const sepEl = document.querySelector('.stat-widget.hp .hp-separator');
    const widget = document.querySelector('.stat-widget.hp');
    if (!curEl) return;

    const { color, level } = hpHealthColor(current, max);
    curEl.style.color = color;
    if (maxEl) {
        // Keep current and max on the same spectrum color (including full = green)
        maxEl.style.color = color;
        maxEl.style.opacity = level === 'full' ? '1' : '0.85';
    }
    if (sepEl) {
        sepEl.style.color = color;
        sepEl.style.opacity = level === 'full' ? '0.85' : '0.65';
    }
    if (widget) {
        widget.dataset.hpLevel = level;
        widget.style.setProperty('--hp-color', color);
    }
}

function initCharacterPanel() {
    document.getElementById('btn-damage-hp').addEventListener('click', () => {
        openHPModal('damage');
    });
    
    document.getElementById('btn-heal-hp').addEventListener('click', () => {
        openHPModal('heal');
    });
    
    document.getElementById('btn-edit-char-modal').addEventListener('click', () => {
        const btn = document.getElementById('btn-edit-char-modal');
        if (btn && btn.disabled) return;
        openEditCharSpecsModal();
    });

    const slotsLongRest = document.getElementById('btn-spell-slots-long-rest');
    if (slotsLongRest && !slotsLongRest.dataset.bound) {
        slotsLongRest.dataset.bound = '1';
        slotsLongRest.addEventListener('click', () => {
            const c = getActiveCharacter();
            if (!c) {
                alert('Select a character first.');
                return;
            }
            if (!c.spellcasting || !c.spellcasting.slots) {
                alert('This character has no spell slots.');
                return;
            }
            if (!confirm('Long Rest — restore all spell slots for ' + (c.name || 'this character') + '?\n\n(Spell slots only; HP and other resources are unchanged.)')) {
                return;
            }
            let restored = 0;
            Object.values(c.spellcasting.slots).forEach(slot => {
                if (slot && slot.expended) {
                    restored += slot.expended;
                    slot.expended = 0;
                }
            });
            saveState();
            renderSelectedCharacter();
            if (restored > 0) {
                logRoll(c.name || 'Character', 'Spell Slots Long Rest', restored,
                    `Restored ${restored} expended spell slot${restored === 1 ? '' : 's'}.`);
                setSyncStatus('Spell slots restored', 'ok');
            } else {
                setSyncStatus('Slots already full', 'ok');
            }
        });
    }

    bindTextareaScrollHosts();
}

function renderCharacterTabs() {
    const active = getActiveCampaign();
    if (!active) return;
    
    const bar = document.getElementById('char-select-bar');
    bar.innerHTML = '';
    
    const charKeys = Object.keys(active.characters);
    
    // Ensure activeCharacterId exists in current campaign characters
    if (charKeys.length > 0 && !charKeys.includes(state.activeCharacterId)) {
        state.activeCharacterId = charKeys[0];
    }
    
    charKeys.forEach(key => {
        const c = active.characters[key];
        const tab = document.createElement('div');
        tab.className = `char-tab ${state.activeCharacterId === key ? 'active' : ''}`;
        tab.addEventListener('click', () => {
            state.activeCharacterId = key;
            saveLocalUi();
            renderCharacterTabs();
            renderSelectedCharacter();
        });
        
        const firstLetter = c.name.charAt(0);
        
        tab.innerHTML = `
            <div class="char-tab-avatar">${firstLetter}</div>
            <div class="char-tab-meta">
                <h4>${c.name.split(' ')[0]}</h4>
                <p>Level ${c.level} ${c.class.split(' ')[0]}</p>
            </div>
        `;
        bar.appendChild(tab);
    });
}

function parseEquipmentLine(line) {
    let s = String(line || '').replace(/^[\s\-\*\u2022]+/, '').trim();
    if (!s) return null;

    let qty = 1;
    let name = s;

    // Patterns: "3x Torch", "3 x Torch", "3× Torch", "Torch x3", "Torch (x3)", "Torch × 3"
    let m = s.match(/^(\d+)\s*[x×]\s*(.+)$/i);
    if (m) {
        qty = parseInt(m[1], 10) || 1;
        name = m[2].trim();
    } else {
        m = s.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
        if (m) {
            name = m[1].trim();
            qty = parseInt(m[2], 10) || 1;
        } else {
            m = s.match(/^(.+?)\s*\(\s*[x×]?\s*(\d+)\s*\)$/i);
            if (m) {
                name = m[1].trim();
                qty = parseInt(m[2], 10) || 1;
            } else {
                m = s.match(/^(\d+)\s+(.+)$/);
                // Only treat leading number as qty if rest doesn't look like a pure measure start awkwardly
                // e.g. "50 ft Rope" keeps as name with qty 1; "3 Torch" -> 3 Torch
                if (m && !/^(ft|feet|gp|sp|cp|pp|lb|lbs)\b/i.test(m[2])) {
                    const rest = m[2].trim();
                    // Prefer "3 Torches" style (qty + short name) over "50 ft Rope"
                    if (rest.split(/\s+/).length <= 4 && !/^\d/.test(rest)) {
                        qty = parseInt(m[1], 10) || 1;
                        name = rest;
                    }
                }
            }
        }
    }

    name = name.replace(/\s+/g, ' ').trim();
    if (!name) return null;
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    return { qty, name, key: name.toLowerCase() };
}

function formatEquipmentLine(item) {
    const q = item.qty > 1 ? (item.qty + 'x ') : '';
    return q + item.name;
}

function parseEquipmentList(equipmentText) {
    const raw = String(equipmentText == null ? '' : equipmentText).trim();
    if (!raw) return [];
    const map = new Map(); // key -> { qty, name, key }
    raw.split(/\r?\n|;|•/g).forEach(line => {
        const parsed = parseEquipmentLine(line);
        if (!parsed) return;
        const existing = map.get(parsed.key);
        if (existing) {
            existing.qty += parsed.qty;
        } else {
            map.set(parsed.key, { qty: parsed.qty, name: parsed.name, key: parsed.key });
        }
    });
    return Array.from(map.values());
}

function serializeEquipmentList(items) {
    return (items || [])
        .filter(it => it && it.name && it.qty > 0)
        .map(formatEquipmentLine)
        .join('\n');
}

function getActiveCharacter() {
    const active = getActiveCampaign();
    if (!active || !state.activeCharacterId) return null;
    return active.characters[state.activeCharacterId] || null;
}

function commitActiveEquipment(items) {
    const c = getActiveCharacter();
    if (!c) return;
    c.equipment = serializeEquipmentList(items);
    renderEquipmentGrid(c.equipment);
    saveState();
}

function canEditPlayerPrivate(charId) {
    if (!charId) return false;
    if (window.SeatSession && typeof SeatSession.isDm === 'function' && SeatSession.isDm()) return true;
    if (window.SeatSession && typeof SeatSession.get === 'function') {
        const s = SeatSession.get();
        if (s && s.role === 'player' && s.characterId === charId) return true;
    }
    // Offline / no seats: allow local editing
    if (!window.SeatSession || typeof SeatSession.get !== 'function' || !SeatSession.get()) return true;
    return false;
}

let _backstoryTab = 'story';

function setBackstoryTab(tab) {
    const canSeePlayerNotes = canEditPlayerPrivate(state.activeCharacterId);
    // Never land on player-notes tab if this viewer isn't allowed to see it
    if (tab === 'player' && !canSeePlayerNotes) tab = 'story';
    _backstoryTab = tab === 'player' ? 'player' : 'story';
    const storyPanel = document.getElementById('char-backstory-panel-story');
    const playerPanel = document.getElementById('char-backstory-panel-player');
    const tabStory = document.getElementById('tab-story-traits');
    const tabPlayer = document.getElementById('tab-player-notes');
    const tabsWrap = document.querySelector('.char-backstory-tabs');

    if (tabPlayer) {
        // Hide the whole tab when viewing another player's sheet as a PC
        tabPlayer.style.display = canSeePlayerNotes ? '' : 'none';
    }
    // If only one visible tab, tighten the tab row chrome
    if (tabsWrap) {
        tabsWrap.style.display = canSeePlayerNotes ? '' : 'none';
    }

    if (storyPanel) storyPanel.style.display = _backstoryTab === 'story' ? '' : 'none';
    if (playerPanel) {
        playerPanel.style.display = (canSeePlayerNotes && _backstoryTab === 'player') ? '' : 'none';
    }
    if (tabStory) {
        tabStory.classList.toggle('active', _backstoryTab === 'story');
        tabStory.setAttribute('aria-selected', _backstoryTab === 'story' ? 'true' : 'false');
    }
    if (tabPlayer) {
        tabPlayer.classList.toggle('active', _backstoryTab === 'player');
        tabPlayer.setAttribute('aria-selected', _backstoryTab === 'player' ? 'true' : 'false');
    }
}

function renderPlayerPrivateNotes(c) {
    const charId = state.activeCharacterId;
    const canEdit = canEditPlayerPrivate(charId);
    const gate = document.getElementById('player-notes-gate-hint');
    const editor = document.getElementById('player-notes-editor');
    const notesEl = document.getElementById('char-player-notes');
    const passEl = document.getElementById('char-player-passphrase');
    const status = document.getElementById('player-notes-status');
    if (status) status.textContent = '';

    // Non-owners: tab is hidden — don't show locked message either
    if (!canEdit) {
        if (gate) gate.style.display = 'none';
        if (editor) editor.style.display = 'none';
        if (notesEl) notesEl.value = '';
        if (passEl) passEl.value = '';
        return;
    }
    if (gate) gate.style.display = 'none';
    if (editor) editor.style.display = 'block';
    if (notesEl) notesEl.value = (c && c.playerNotes) || '';
    if (passEl) passEl.value = (c && c.playerPassphrase) || '';
}

function initPlayerNotesUi() {
    document.querySelectorAll('[data-backstory-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            setBackstoryTab(btn.getAttribute('data-backstory-tab'));
        });
    });
    const saveBtn = document.getElementById('btn-save-player-notes');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const active = getActiveCampaign();
            if (!active) return;
            const charId = state.activeCharacterId;
            if (!canEditPlayerPrivate(charId)) {
                alert('Only the seated player for this character (or DM) can edit private notes.');
                return;
            }
            const c = active.characters[charId];
            if (!c) return;
            c.playerNotes = (document.getElementById('char-player-notes') || {}).value || '';
            c.playerPassphrase = (document.getElementById('char-player-passphrase') || {}).value || '';
            const status = document.getElementById('player-notes-status');
            if (status) status.textContent = 'Saving…';
            saveState();
            // Piecewise save if available
            if (typeof smartSaveToServer === 'function' && IS_SERVER_MODE) {
                await smartSaveToServer();
            }
            if (status) status.textContent = 'Saved.';
        });
    }
}

function renderBackstoryAndTraits(c) {
    const el = document.getElementById('char-backstory');
    if (!el) return;
    el.className = 'char-backstory-text';
    el.innerHTML = '';

    const features = (c && c.features && typeof c.features === 'object') ? c.features : {};
    const sections = [];

    const pushSection = (title, text) => {
        const t = String(text == null ? '' : text).trim();
        if (!t) return;
        sections.push({ title, text: t });
    };

    pushSection('Backstory', c && c.backstory);
    pushSection('Class Features', features.classFeatures);
    pushSection('Species Traits', features.speciesTraits);
    pushSection('Feats', features.feats);

    // Any other feature keys
    Object.keys(features).forEach(k => {
        if (k === 'classFeatures' || k === 'speciesTraits' || k === 'feats') return;
        const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
        pushSection(label, features[k]);
    });

    if (!sections.length) {
        const p = document.createElement('p');
        p.className = 'backstory-empty';
        p.textContent = 'No backstory or traits written for this character.';
        el.appendChild(p);
    } else {
        sections.forEach(sec => {
            const wrap = document.createElement('section');
            wrap.className = 'backstory-section';
            const h = document.createElement('h4');
            h.textContent = sec.title;
            const body = document.createElement('div');
            body.className = 'backstory-body';
            body.textContent = sec.text;
            wrap.appendChild(h);
            wrap.appendChild(body);
            el.appendChild(wrap);
        });
    }

    renderPlayerPrivateNotes(c);
    setBackstoryTab(_backstoryTab || 'story');
}

function renderEquipmentGrid(equipmentText) {
    const el = document.getElementById('char-equipment');
    if (!el) return;
    el.innerHTML = '';
    el.className = 'equipment-grid';

    const items = parseEquipmentList(equipmentText);
    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'equipment-empty';
        empty.textContent = 'No items listed. Use Add to put something in the pack.';
        el.appendChild(empty);
        return;
    }

    items.forEach((item, index) => {
        const cell = document.createElement('div');
        cell.className = 'equipment-item';
        cell.innerHTML =
            '<div class="equipment-item-main" title="' + escapeHtml(item.qty + '× ' + item.name) + '">' +
                '<span class="equipment-qty">' + escapeHtml(String(item.qty)) + '×</span>' +
                '<span class="equipment-name">' + escapeHtml(item.name) + '</span>' +
            '</div>' +
            '<div class="equipment-item-actions">' +
                '<button type="button" class="equip-btn equip-btn-transfer" title="Transfer to another party member" data-idx="' + index + '">' +
                    '<i class="fa-solid fa-right-left"></i>' +
                '</button>' +
                '<button type="button" class="equip-btn equip-btn-remove" title="Remove some or all" data-idx="' + index + '">' +
                    '<i class="fa-solid fa-minus"></i>' +
                '</button>' +
            '</div>';

        cell.querySelector('.equip-btn-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            removeEquipmentItem(item.key);
        });
        cell.querySelector('.equip-btn-transfer').addEventListener('click', (e) => {
            e.stopPropagation();
            transferEquipmentItem(item.key);
        });

        el.appendChild(cell);
    });
}

function addEquipmentFromForm() {
    const c = getActiveCharacter();
    if (!c) {
        alert('Select a character first.');
        return;
    }
    const qtyEl = document.getElementById('equip-qty-input');
    const nameEl = document.getElementById('equip-name-input');
    let qty = qtyEl ? parseInt(qtyEl.value, 10) : 1;
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
        alert('Enter an item name.');
        if (nameEl) nameEl.focus();
        return;
    }
    if (!Number.isFinite(qty) || qty < 1) qty = 1;

    const items = parseEquipmentList(c.equipment);
    const key = name.toLowerCase();
    const existing = items.find(it => it.key === key);
    if (existing) {
        // Match (case-insensitive): increase quantity (by entered amount; default 1)
        existing.qty += qty;
        // Keep nicer casing if user typed a better label? keep original existing.name
    } else {
        items.push({ qty, name, key });
    }
    // stable-ish sort by name
    items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    commitActiveEquipment(items);

    const modal = document.getElementById('modal-add-equipment');
    if (modal) modal.style.display = 'none';
    if (qtyEl) qtyEl.value = '1';
    if (nameEl) nameEl.value = '';
}

function removeEquipmentItem(itemKey) {
    const c = getActiveCharacter();
    if (!c) return;
    const items = parseEquipmentList(c.equipment);
    const item = items.find(it => it.key === itemKey);
    if (!item) return;

    const ans = prompt(
        'Remove how many "' + item.name + '"?\n\n' +
        'Currently: ' + item.qty + '\n' +
        'Enter a number, or ALL to remove them all.',
        '1'
    );
    if (ans == null) return;
    const trimmed = String(ans).trim();
    let removeQty;
    if (/^all$/i.test(trimmed)) {
        removeQty = item.qty;
    } else {
        removeQty = parseInt(trimmed, 10);
        if (!Number.isFinite(removeQty) || removeQty < 1) {
            alert('Enter a positive number or ALL.');
            return;
        }
    }

    item.qty -= removeQty;
    const next = items.filter(it => it.qty > 0);
    commitActiveEquipment(next);
}

function transferEquipmentItem(itemKey) {
    const active = getActiveCampaign();
    const from = getActiveCharacter();
    if (!active || !from) return;

    const items = parseEquipmentList(from.equipment);
    const item = items.find(it => it.key === itemKey);
    if (!item) return;

    const party = Object.keys(active.characters || {})
        .filter(id => id !== state.activeCharacterId)
        .map(id => {
            const ch = active.characters[id];
            return {
                id,
                label: (ch && ch.name ? ch.name : id) + (ch && ch.player ? ' (' + ch.player + ')' : '')
            };
        });

    if (!party.length) {
        alert('No other party members to transfer to.');
        return;
    }

    const roster = party.map((p, i) => (i + 1) + ') ' + p.label).join('\n');
    const who = prompt(
        'Transfer "' + item.name + '" to which party member?\n\n' + roster +
        '\n\nType the number or the character name:',
        '1'
    );
    if (who == null) return;

    const whoTrim = String(who).trim();
    let targetId = null;
    if (/^\d+$/.test(whoTrim)) {
        const n = parseInt(whoTrim, 10);
        if (n >= 1 && n <= party.length) targetId = party[n - 1].id;
    }
    if (!targetId) {
        const low = whoTrim.toLowerCase();
        const hit = party.find(p =>
            p.id.toLowerCase() === low ||
            p.label.toLowerCase() === low ||
            p.label.toLowerCase().startsWith(low) ||
            (active.characters[p.id] && active.characters[p.id].name &&
                active.characters[p.id].name.toLowerCase() === low)
        );
        if (hit) targetId = hit.id;
    }
    if (!targetId || !active.characters[targetId]) {
        alert('Could not match that party member.');
        return;
    }

    const qtyAns = prompt(
        'How many "' + item.name + '" to give to ' +
        (active.characters[targetId].name || targetId) + '?\n\nCurrently: ' + item.qty +
        '\nEnter a number, or ALL.',
        '1'
    );
    if (qtyAns == null) return;
    const qt = String(qtyAns).trim();
    let moveQty;
    if (/^all$/i.test(qt)) moveQty = item.qty;
    else {
        moveQty = parseInt(qt, 10);
        if (!Number.isFinite(moveQty) || moveQty < 1) {
            alert('Enter a positive number or ALL.');
            return;
        }
    }
    if (moveQty > item.qty) moveQty = item.qty;

    // Remove from source
    item.qty -= moveQty;
    const fromNext = items.filter(it => it.qty > 0);

    // Add to target (case-insensitive stack)
    const toChar = active.characters[targetId];
    const toItems = parseEquipmentList(toChar.equipment);
    const existing = toItems.find(it => it.key === item.key);
    if (existing) existing.qty += moveQty;
    else toItems.push({ qty: moveQty, name: item.name, key: item.key });
    toItems.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    toChar.equipment = serializeEquipmentList(toItems);

    from.equipment = serializeEquipmentList(fromNext);
    renderEquipmentGrid(from.equipment);
    // Both characters changed — full document save so receiver gets the items too
    saveStateToServer().then(ok => {
        if (!ok) {
            setSyncStatus('Transfer save failed', 'err');
            alert('Transfer applied locally but server save failed. Check sync status.');
        } else {
            setSyncStatus('Transferred', 'ok');
        }
    });
}

function initEquipmentInventory() {
    const addBtn = document.getElementById('btn-equip-add');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            if (!getActiveCharacter()) {
                alert('Select a character first.');
                return;
            }
            const qty = document.getElementById('equip-qty-input');
            const name = document.getElementById('equip-name-input');
            if (qty) qty.value = '1';
            if (name) name.value = '';
            const modal = document.getElementById('modal-add-equipment');
            if (modal) modal.style.display = 'flex';
            if (name) setTimeout(() => name.focus(), 50);
        });
    }
    const saveBtn = document.getElementById('btn-save-equipment');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => addEquipmentFromForm());
    }
    const nameInput = document.getElementById('equip-name-input');
    if (nameInput) {
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addEquipmentFromForm();
            }
        });
    }
}

// Standard D&D skills (key, label, ability)
const STANDARD_SKILL_LIST = [
    { key: 'acrobatics', label: 'Acrobatics', ab: 'DEX' },
    { key: 'animalHandling', label: 'Animal Handling', ab: 'WIS' },
    { key: 'arcana', label: 'Arcana', ab: 'INT' },
    { key: 'athletics', label: 'Athletics', ab: 'STR' },
    { key: 'deception', label: 'Deception', ab: 'CHA' },
    { key: 'history', label: 'History', ab: 'INT' },
    { key: 'insight', label: 'Insight', ab: 'WIS' },
    { key: 'intimidation', label: 'Intimidation', ab: 'CHA' },
    { key: 'investigation', label: 'Investigation', ab: 'INT' },
    { key: 'medicine', label: 'Medicine', ab: 'WIS' },
    { key: 'nature', label: 'Nature', ab: 'INT' },
    { key: 'perception', label: 'Perception', ab: 'WIS' },
    { key: 'performance', label: 'Performance', ab: 'CHA' },
    { key: 'persuasion', label: 'Persuasion', ab: 'CHA' },
    { key: 'religion', label: 'Religion', ab: 'INT' },
    { key: 'sleightOfHand', label: 'Sleight of Hand', ab: 'DEX' },
    { key: 'stealth', label: 'Stealth', ab: 'DEX' },
    { key: 'survival', label: 'Survival', ab: 'WIS' }
];

const ABILITY_FULL_NAMES = {
    STR: 'Strength',
    DEX: 'Dexterity',
    CON: 'Constitution',
    INT: 'Intelligence',
    WIS: 'Wisdom',
    CHA: 'Charisma'
};

// UI-only: which ability skill groups are open (not synced)
const skillGroupOpen = {
    STR: false,
    DEX: false,
    CON: false,
    INT: false,
    WIS: false,
    CHA: false
};

function skillKeyFromName(name) {
    const base = String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase())
        .replace(/[^a-zA-Z0-9]/g, '');
    return base || ('custom' + Date.now());
}

function normalizeSkillModifier(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return '+0';
    if (/^[+-]?\d+$/.test(s)) {
        const n = parseInt(s, 10);
        return (n >= 0 ? '+' : '') + n;
    }
    // allow "+ 2" etc.
    const m = s.match(/^([+-])\s*(\d+)$/);
    if (m) return m[1] + parseInt(m[2], 10);
    return s;
}

function getCharacterSkillEntries(c) {
    if (!c.skills) c.skills = {};
    if (!Array.isArray(c.customSkills)) c.customSkills = [];

    const entries = STANDARD_SKILL_LIST.map(s => ({
        key: s.key,
        label: s.label,
        ab: s.ab,
        custom: false,
        val: c.skills[s.key] != null && c.skills[s.key] !== ''
            ? c.skills[s.key]
            : (c.abilities && c.abilities[s.ab] ? c.abilities[s.ab].mod : '+0')
    }));

    c.customSkills.forEach(cs => {
        if (!cs || !cs.name) return;
        const key = cs.key || skillKeyFromName(cs.name);
        const ab = (cs.ability || cs.ab || 'INT').toUpperCase();
        const val = cs.modifier != null && cs.modifier !== ''
            ? normalizeSkillModifier(cs.modifier)
            : (c.skills[key] != null ? c.skills[key] : '+0');
        // keep skills map in sync for rolls / recalculation consumers
        if (c.skills[key] == null) c.skills[key] = val;
        entries.push({
            key,
            label: cs.name,
            ab: ABILITY_FULL_NAMES[ab] ? ab : 'INT',
            custom: true,
            val: c.skills[key] || val
        });
    });

    return entries;
}

function renderCharacterSkills(c, searchQuery) {
    const skillsCont = document.getElementById('char-skills-container');
    if (!skillsCont) return;
    skillsCont.innerHTML = '';

    const q = String(searchQuery == null
        ? ((document.getElementById('skills-search-input') || {}).value || '')
        : searchQuery).trim().toLowerCase();

    const entries = getCharacterSkillEntries(c);
    const abilityOrder = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

    let anyVisible = false;

    abilityOrder.forEach(ab => {
        let groupSkills = entries.filter(s => s.ab === ab);
        if (q) {
            groupSkills = groupSkills.filter(s =>
                s.label.toLowerCase().includes(q) ||
                s.ab.toLowerCase().includes(q) ||
                String(s.val).toLowerCase().includes(q) ||
                (ABILITY_FULL_NAMES[ab] || '').toLowerCase().includes(q)
            );
        }
        if (!groupSkills.length) return;
        anyVisible = true;

        // Auto-open groups that match search
        const forceOpen = !!q;
        const isOpen = forceOpen || !!skillGroupOpen[ab];

        const group = document.createElement('div');
        group.className = 'skill-ability-group' + (isOpen ? ' is-open' : '');
        group.dataset.ability = ab;

        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'skill-group-header';
        header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        const abModHeader = (c.abilities && c.abilities[ab] && c.abilities[ab].mod != null)
            ? String(c.abilities[ab].mod)
            : '+0';
        header.innerHTML =
            '<span class="skill-group-chevron"><i class="fa-solid fa-chevron-right"></i></span>' +
            '<span class="skill-group-name">' + escapeHtml(ABILITY_FULL_NAMES[ab] || ab) +
            ' <span class="skill-group-ab">(' + ab + ')</span></span>' +
            '<span class="skill-group-mod" title="' + escapeHtml((ABILITY_FULL_NAMES[ab] || ab) + ' modifier') + '">' +
                escapeHtml(abModHeader) +
            '</span>';

        header.addEventListener('click', () => {
            skillGroupOpen[ab] = !skillGroupOpen[ab];
            renderCharacterSkills(c);
        });

        const body = document.createElement('div');
        body.className = 'skill-group-body';
        if (!isOpen) body.hidden = true;

        groupSkills
            .slice()
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
            .forEach(s => {
                const abMod = (c.abilities && c.abilities[s.ab] && c.abilities[s.ab].mod) || '+0';
                const isProf = String(s.val) !== String(abMod);
                const item = document.createElement('div');
                item.className = 'skill-item' + (s.custom ? ' is-custom' : '');
                item.innerHTML =
                    '<span class="skill-label">' +
                        '<span class="prof-dot ' + (isProf ? 'proficient' : '') + '"></span>' +
                        escapeHtml(s.label) +
                        (s.custom ? ' <span class="skill-custom-tag">custom</span>' : '') +
                    '</span>' +
                    '<span class="skill-val" title="Roll ' + escapeHtml(s.label) + ' check!">' +
                        escapeHtml(String(s.val)) +
                    '</span>';

                item.querySelector('.skill-val').addEventListener('click', () => {
                    rollForCharacter(c.name, s.label + ' Skill Check', s.val);
                });

                if (s.custom) {
                    const rm = document.createElement('button');
                    rm.type = 'button';
                    rm.className = 'skill-remove-btn';
                    rm.title = 'Remove custom skill';
                    rm.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                    rm.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (!confirm('Remove custom skill "' + s.label + '"?')) return;
                        c.customSkills = (c.customSkills || []).filter(cs =>
                            (cs.key || skillKeyFromName(cs.name)) !== s.key
                        );
                        if (c.skills && Object.prototype.hasOwnProperty.call(c.skills, s.key)) {
                            delete c.skills[s.key];
                        }
                        saveState();
                        renderCharacterSkills(c);
                    });
                    item.appendChild(rm);
                }

                body.appendChild(item);
            });

        group.appendChild(header);
        group.appendChild(body);
        skillsCont.appendChild(group);
    });

    if (!anyVisible) {
        const empty = document.createElement('p');
        empty.className = 'skills-empty';
        empty.textContent = q ? 'No skills match your search.' : 'No skills listed.';
        skillsCont.appendChild(empty);
    }
}

function addCustomSkillFromForm() {
    const c = getActiveCharacter();
    if (!c) {
        alert('Select a character first.');
        return;
    }
    const nameEl = document.getElementById('skill-name-input');
    const modEl = document.getElementById('skill-mod-input');
    const abEl = document.getElementById('skill-ability-input');
    const name = nameEl ? nameEl.value.trim() : '';
    const ab = abEl ? String(abEl.value || 'INT').toUpperCase() : 'INT';
    const mod = normalizeSkillModifier(modEl ? modEl.value : '+0');

    if (!name) {
        alert('Enter a skill name.');
        if (nameEl) nameEl.focus();
        return;
    }
    if (!ABILITY_FULL_NAMES[ab]) {
        alert('Pick a valid ability.');
        return;
    }

    if (!Array.isArray(c.customSkills)) c.customSkills = [];
    if (!c.skills) c.skills = {};

    // Case-insensitive duplicate against standard + custom
    const all = getCharacterSkillEntries(c);
    const dup = all.find(s => s.label.toLowerCase() === name.toLowerCase());
    if (dup) {
        // Update existing custom or override value on standard skill
        if (dup.custom) {
            const cs = c.customSkills.find(x => (x.key || skillKeyFromName(x.name)) === dup.key);
            if (cs) {
                cs.modifier = mod;
                cs.ability = ab;
                cs.name = name;
            }
        }
        c.skills[dup.key] = mod;
        // If standard skill, also store ability override? keep standard ab
    } else {
        let key = skillKeyFromName(name);
        if (c.skills[key] != null || STANDARD_SKILL_LIST.some(s => s.key === key)) {
            key = key + '_' + Date.now().toString(36);
        }
        c.customSkills.push({
            key,
            name,
            ability: ab,
            modifier: mod
        });
        c.skills[key] = mod;
    }

    // Open the ability group so the new skill is visible
    skillGroupOpen[ab] = true;
    saveState();
    renderCharacterSkills(c);

    const modal = document.getElementById('modal-add-skill');
    if (modal) modal.style.display = 'none';
    if (nameEl) nameEl.value = '';
    if (modEl) modEl.value = '+0';
    if (abEl) abEl.value = 'INT';
}

function initSkillsPanel() {
    const search = document.getElementById('skills-search-input');
    if (search && !search.dataset.bound) {
        search.dataset.bound = '1';
        search.addEventListener('input', () => {
            const c = getActiveCharacter();
            if (c) renderCharacterSkills(c, search.value);
        });
    }
    const expandAll = document.getElementById('btn-skills-expand-all');
    if (expandAll && !expandAll.dataset.bound) {
        expandAll.dataset.bound = '1';
        expandAll.addEventListener('click', () => {
            Object.keys(skillGroupOpen).forEach(k => { skillGroupOpen[k] = true; });
            const c = getActiveCharacter();
            if (c) renderCharacterSkills(c);
        });
    }
    const collapseAll = document.getElementById('btn-skills-collapse-all');
    if (collapseAll && !collapseAll.dataset.bound) {
        collapseAll.dataset.bound = '1';
        collapseAll.addEventListener('click', () => {
            Object.keys(skillGroupOpen).forEach(k => { skillGroupOpen[k] = false; });
            const searchEl = document.getElementById('skills-search-input');
            if (searchEl) searchEl.value = '';
            const c = getActiveCharacter();
            if (c) renderCharacterSkills(c);
        });
    }
    const addBtn = document.getElementById('btn-skill-add');
    if (addBtn && !addBtn.dataset.bound) {
        addBtn.dataset.bound = '1';
        addBtn.addEventListener('click', () => {
            if (!getActiveCharacter()) {
                alert('Select a character first.');
                return;
            }
            const modal = document.getElementById('modal-add-skill');
            const name = document.getElementById('skill-name-input');
            const mod = document.getElementById('skill-mod-input');
            const ab = document.getElementById('skill-ability-input');
            if (name) name.value = '';
            if (mod) mod.value = '+0';
            if (ab) ab.value = 'INT';
            if (modal) modal.style.display = 'flex';
            if (name) setTimeout(() => name.focus(), 50);
        });
    }
    const saveBtn = document.getElementById('btn-save-skill');
    if (saveBtn && !saveBtn.dataset.bound) {
        saveBtn.dataset.bound = '1';
        saveBtn.addEventListener('click', () => addCustomSkillFromForm());
    }
    const nameInput = document.getElementById('skill-name-input');
    if (nameInput && !nameInput.dataset.bound) {
        nameInput.dataset.bound = '1';
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addCustomSkillFromForm();
            }
        });
    }
}

function renderSelectedCharacter() {
    const active = getActiveCampaign();
    if (!active) return;
    
    const c = active.characters[state.activeCharacterId];
    if (!c) {
        // No character found panel placeholder
        return;
    }


    updateCharSheetChrome();
    
    // Core summary data
    document.getElementById('char-species').innerText = c.species || 'Unknown';
    document.getElementById('char-class').innerText = `${c.class} ${c.subclass ? '(' + c.subclass + ')' : ''}`;
    document.getElementById('char-level').innerText = c.level;
    document.getElementById('char-xp').innerText = c.xp || '0';
    document.getElementById('char-background').innerText = c.background || 'None';
    
    // Combat specs
    document.getElementById('char-hp-current').innerText = c.hp.current;
    document.getElementById('char-hp-max').innerText = c.hp.max;
    updateCharacterHpColor(c.hp.current, c.hp.max);
    document.getElementById('char-ac').innerText = c.ac;
    document.getElementById('char-speed').innerText = c.speed || '30 ft';
    
    const initVal = c.initiative || '+0';
    document.getElementById('char-initiative').innerText = initVal;
    document.getElementById('char-initiative').onclick = () => {
        rollForCharacter(c.name, 'Initiative Check', initVal);
    };
    
    // Backstory & traits (full-width block under sheet)
    renderBackstoryAndTraits(c);

    // Equipment inventory — 4-column grid of line items
    renderEquipmentGrid(c.equipment);
    
    // Abilities list: Score | Modifiers | Saving Throws
    const abCont = document.getElementById('char-abilities-container');
    abCont.innerHTML = '';
    
    const abilityOrder = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
    if (!c.saves) c.saves = {};
    abilityOrder.forEach(ab => {
        if (!c.abilities[ab]) {
            c.abilities[ab] = { score: 10, mod: '+0' };
        }
        const score = c.abilities[ab].score;
        const mod = c.abilities[ab].mod;
        const saveVal = (c.saves[ab] != null && c.saves[ab] !== '')
            ? c.saves[ab]
            : mod;
        const saveStr = String(saveVal);
        const modStr = String(mod);
        const isProf = !!(c.saveProfs && c.saveProfs.includes(ab)) ||
            (saveStr !== modStr && saveStr.replace(/^\+/, '') !== modStr.replace(/^\+/, ''));
        
        const card = document.createElement('div');
        card.className = 'ability-card';
        card.innerHTML = `
            <span class="ability-name">${ab}</span>
            <div class="ability-stats-row">
                <span class="ability-score" title="${ab} score">${score}</span>
                <span class="ability-mod" title="Click to roll ${ab} check!">${mod}</span>
                <span class="ability-save ${isProf ? 'is-proficient' : ''}" title="Click to roll ${ab} saving throw!">${saveStr}</span>
            </div>
        `;
        
        card.querySelector('.ability-mod').addEventListener('click', () => {
            rollForCharacter(c.name, `${ab} Ability Check`, mod);
        });
        card.querySelector('.ability-save').addEventListener('click', () => {
            rollForCharacter(c.name, `${ab} Saving Throw`, saveStr);
        });
        
        abCont.appendChild(card);
    });
    
    // Extra (non-ability) saving throws — reserved for future; keep container empty for now
    const savesCont = document.getElementById('char-saves-container');
    if (savesCont) {
        savesCont.innerHTML = '';
        savesCont.hidden = true;
    }
    
    // Skills list (searchable, collapsible by ability)
    renderCharacterSkills(c);
    
    // Weapons and attacks list
    const weaponsCont = document.getElementById('char-weapons-container');
    weaponsCont.innerHTML = '';
    
    if (!c.weapons || c.weapons.length === 0) {
        weaponsCont.innerHTML = '<p style="padding: 10px; color: var(--text-muted); font-style: italic;">No weapons equipped.</p>';
    } else {
        c.weapons.forEach(w => {
            const row = document.createElement('div');
            row.className = 'weapon-row';
            row.innerHTML = `
                <span class="weapon-name" style="cursor: pointer; color: var(--border-gold);" title="Roll Attack!">${w.name}</span>
                <span class="weapon-bonus" style="font-family: var(--font-heading); font-weight: 700; color: var(--border-gold); cursor: pointer;" title="Roll Attack!">${w.bonus}</span>
                <span class="weapon-dmg" style="cursor: pointer; text-decoration: underline;" title="Roll Damage!">${w.damage}</span>
                <span class="weapon-notes">${w.notes || ''}</span>
            `;
            
            const rollAttack = () => {
                const attackRoll = rollDie(20);
                const bonusInt = parseInt(w.bonus) || 0;
                const total = attackRoll + bonusInt;
                let detail = `Natural ${attackRoll} + ${bonusInt} bonus`;
                let crit = '';
                if (attackRoll === 20) { crit = ' (CRITICAL HIT!)'; }
                if (attackRoll === 1) { crit = ' (CRITICAL FUMBLE!)'; }
                
                logRoll(c.name, `Attack: ${w.name}`, total, `Rolled d20: ${detail}${crit}`, attackRoll);
                switchToCombatPanel();
            };
            
            row.querySelector('.weapon-name').addEventListener('click', rollAttack);
            row.querySelector('.weapon-bonus').addEventListener('click', rollAttack);
            
            row.querySelector('.weapon-dmg').addEventListener('click', () => {
                const dmgStr = w.damage.toLowerCase();
                const match = dmgStr.match(/(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?/);
                
                if (match) {
                    const count = parseInt(match[1]);
                    const sides = parseInt(match[2]);
                    const sign = match[3];
                    const mod = match[4] ? parseInt(match[4]) : 0;
                    
                    let rolls = [];
                    let sum = 0;
                    for (let i = 0; i < count; i++) {
                        const r = rollDie(sides);
                        rolls.push(r);
                        sum += r;
                    }
                    
                    let modifier = 0;
                    if (sign && mod) {
                        modifier = sign === '+' ? mod : -mod;
                    }
                    
                    const total = sum + modifier;
                    const damageType = dmgStr.split(' ').slice(2).join(' ') || 'damage';
                    const detail = `[${rolls.join(',')}]${modifier !== 0 ? ' ' + sign + ' ' + Math.abs(modifier) : ''}`;
                    
                    logRoll(c.name, `Damage: ${w.name}`, total, `Rolled ${count}d${sides}: ${detail} (${damageType})`);
                    switchToCombatPanel();
                } else {
                    const total = rollDie(6);
                    logRoll(c.name, `Damage: ${w.name}`, total, `Rolled 1d6 damage.`);
                    switchToCombatPanel();
                }
            });
            
            weaponsCont.appendChild(row);
        });
    }
    
    // Spells list
    const spellsCont = document.getElementById('char-spells-container');
    spellsCont.innerHTML = '';
    
    if (!c.spells || c.spells.length === 0) {
        spellsCont.innerHTML = '<p style="padding: 10px; color: var(--text-muted); font-style: italic;">No spells prepared.</p>';
    } else {
        c.spells.forEach(s => {
            const row = document.createElement('div');
            row.className = 'spell-row';
            
            const levelLabel = s.level === 0 ? 'Cantrip' : `Level ${s.level}`;
            const timeRange = `${s.castingTime || 'Action'} / ${s.range || 'Self'}`;
            
            row.innerHTML = `
                <span class="spell-name" style="cursor: pointer; color: var(--border-gold);" title="Roll Spell!">${s.name}</span>
                <span class="spell-level" style="font-size: 0.8rem;">${levelLabel}</span>
                <span class="spell-meta">${timeRange}</span>
                <span class="spell-notes">${s.notes || ''}</span>
            `;
            
            row.querySelector('.spell-name').addEventListener('click', () => {
                const notes = s.notes || '';
                const matchDmg = notes.match(/(\d+)d(\d+)/i);
                
                if (matchDmg) {
                    const count = parseInt(matchDmg[1]);
                    const sides = parseInt(matchDmg[2]);
                    let rolls = [];
                    let sum = 0;
                    for (let i = 0; i < count; i++) {
                        const r = rollDie(sides);
                        rolls.push(r);
                        sum += r;
                    }
                    
                    let spellAttackText = '';
                    let totalRoll = sum;
                    
                    if (notes.toLowerCase().includes('attack')) {
                        const attackRoll = rollDie(20);
                        const spellBonus = parseInt(c.spellcasting.attackBonus) || 0;
                        const attackTotal = attackRoll + spellBonus;
                        spellAttackText = `Attack Roll: ${attackTotal} (d20: ${attackRoll} + ${spellBonus}), `;
                    }
                    
                    logRoll(c.name, `Cast: ${s.name}`, totalRoll, `Rolled ${count}d${sides}: [${rolls.join(',')}] (${spellAttackText}Notes: ${notes})`);
                    switchToCombatPanel();
                } else {
                    logRoll(c.name, `Cast: ${s.name}`, '-', `Prepared Spell level ${s.level} cast (Notes: ${notes})`);
                    switchToCombatPanel();
                }
            });
            
            spellsCont.appendChild(row);
        });
    }
    
    // Spell slots
    const slotsCard = document.getElementById('char-spell-slots-card');
    const slotsCont = document.getElementById('char-spell-slots-container');
    slotsCont.innerHTML = '';
    
    let hasSlots = false;
    if (c.spellcasting && c.spellcasting.slots) {
        // Stable order lvl1, lvl2, ...
        const levels = Object.keys(c.spellcasting.slots).sort((a, b) => {
            const na = parseInt(String(a).replace(/\D/g, ''), 10) || 0;
            const nb = parseInt(String(b).replace(/\D/g, ''), 10) || 0;
            return na - nb;
        });
        levels.forEach(lvl => {
            const slot = c.spellcasting.slots[lvl];
            if (slot.total > 0) {
                hasSlots = true;
                
                const slotNum = lvl.replace('lvl', '');
                const expended = slot.expended || 0;
                const remaining = Math.max(0, slot.total - expended);
                const row = document.createElement('div');
                row.className = 'spell-slot-row';
                
                const label = document.createElement('span');
                label.className = 'spell-slot-label';
                label.innerText = `Level ${slotNum} Slot (${remaining}/${slot.total})`;
                row.appendChild(label);
                
                const bubbles = document.createElement('div');
                bubbles.className = 'spell-slot-bubbles';
                
                for (let i = 0; i < slot.total; i++) {
                    const bubble = document.createElement('span');
                    bubble.className = `slot-bubble ${i < remaining ? 'active' : 'expended'}`;
                    
                    bubble.addEventListener('click', () => {
                        const currentExpended = slot.expended || 0;
                        if (i < (slot.total - currentExpended)) {
                            slot.expended = slot.total - i;
                        } else {
                            slot.expended = slot.total - i - 1;
                        }
                        saveState();
                        renderSelectedCharacter();
                    });
                    
                    bubbles.appendChild(bubble);
                }
                
                row.appendChild(bubbles);

                const minus = document.createElement('button');
                minus.type = 'button';
                minus.className = 'spell-slot-minus';
                minus.title = remaining > 0
                    ? `Expend one Level ${slotNum} slot`
                    : `No Level ${slotNum} slots left`;
                minus.innerHTML = '<i class="fa-solid fa-minus"></i>';
                minus.disabled = remaining <= 0;
                minus.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if ((slot.expended || 0) >= slot.total) return;
                    slot.expended = (slot.expended || 0) + 1;
                    saveState();
                    renderSelectedCharacter();
                });
                row.appendChild(minus);

                slotsCont.appendChild(row);
            }
        });
    }
    
    slotsCard.style.display = hasSlots ? 'block' : 'none';

    renderCharacterResources(c);
    renderCoins(c);
}

/* ---------------- Limited-use resources & rests ---------------- */

function renderCharacterResources(c) {
    const cont = document.getElementById('char-resources-container');
    if (!cont) return;
    cont.innerHTML = '';

    if (!Array.isArray(c.resources) || c.resources.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'resource-empty';
        empty.innerText = 'No tracked resources yet.';
        cont.appendChild(empty);
        return;
    }

    c.resources.forEach((r, idx) => {
        const row = document.createElement('div');
        row.className = 'resource-row';

        const name = document.createElement('span');
        name.className = 'resource-name';
        name.innerText = r.name;
        name.title = 'Click to rename';
        name.addEventListener('click', () => {
            const next = prompt('Resource name:', r.name);
            if (next !== null && next.trim()) {
                r.name = next.trim();
                saveState();
                renderSelectedCharacter();
            }
        });
        row.appendChild(name);

        const tag = document.createElement('span');
        tag.className = 'resource-reset-tag reset-' + (r.reset || 'long');
        tag.innerText = r.reset === 'short' ? 'Short' : r.reset === 'manual' ? 'Manual' : 'Long';
        tag.title = 'Click to change when this refills';
        tag.addEventListener('click', () => {
            const order = ['long', 'short', 'manual'];
            r.reset = order[(order.indexOf(r.reset || 'long') + 1) % order.length];
            saveState();
            renderSelectedCharacter();
        });
        row.appendChild(tag);

        const ctrl = document.createElement('div');
        ctrl.className = 'resource-ctrl';

        const minus = document.createElement('button');
        minus.className = 'resource-btn';
        minus.innerText = '\u2212';
        minus.addEventListener('click', () => {
            r.current = Math.max(0, (r.current || 0) - 1);
            saveState();
            renderSelectedCharacter();
        });
        ctrl.appendChild(minus);

        const val = document.createElement('span');
        val.className = 'resource-value' + ((r.current || 0) === 0 ? ' depleted' : '');
        val.innerText = `${r.current || 0} / ${r.max || 0}`;
        ctrl.appendChild(val);

        const plus = document.createElement('button');
        plus.className = 'resource-btn';
        plus.innerText = '+';
        plus.addEventListener('click', () => {
            r.current = Math.min(r.max || 0, (r.current || 0) + 1);
            saveState();
            renderSelectedCharacter();
        });
        ctrl.appendChild(plus);

        const del = document.createElement('button');
        del.className = 'resource-btn resource-del';
        del.innerText = '\u00d7';
        del.title = 'Remove this resource';
        del.addEventListener('click', () => {
            if (confirm(`Remove "${r.name}"?`)) {
                c.resources.splice(idx, 1);
                saveState();
                renderSelectedCharacter();
            }
        });
        ctrl.appendChild(del);

        row.appendChild(ctrl);
        cont.appendChild(row);
    });
}

function applyRest(c, kind) {
    const notes = [];

    if (kind === 'long') {
        c.hp.current = c.hp.max;
        c.hp.temp = 0;
        notes.push('HP restored to full');
    }

    // Spell slots. Warlock pact slots come back on a short rest too.
    const isWarlock = (c.class || '').includes('Warlock');
    if (c.spellcasting && c.spellcasting.slots) {
        let restored = 0;
        Object.values(c.spellcasting.slots).forEach(slot => {
            if (kind === 'long' || isWarlock) {
                if (slot.expended) restored += slot.expended;
                slot.expended = 0;
            }
        });
        if (restored > 0) {
            notes.push(`${restored} spell slot${restored === 1 ? '' : 's'} restored`);
        }
    }

    let resCount = 0;
    (c.resources || []).forEach(r => {
        if (r.reset === 'manual') return;
        if (kind === 'long' || r.reset === 'short') {
            if (r.current !== r.max) resCount++;
            r.current = r.max;
        }
    });
    if (resCount > 0) {
        notes.push(`${resCount} resource${resCount === 1 ? '' : 's'} refilled`);
    }

    // Keep the combat tracker in step after a long rest.
    if (kind === 'long') {
        (state.combatants || []).forEach(cb => {
            if (cb.name === c.name) {
                cb.hp = c.hp.current;
                cb.maxHp = c.hp.max;
            }
        });
    }

    return notes;
}

/* ---------------- Coin purse ---------------- */

const COIN_TYPES = [
    { key: 'pp', label: 'PP', title: 'Platinum', rate: 10 },
    { key: 'gp', label: 'GP', title: 'Gold', rate: 1 },
    { key: 'ep', label: 'EP', title: 'Electrum', rate: 0.5 },
    { key: 'sp', label: 'SP', title: 'Silver', rate: 0.1 },
    { key: 'cp', label: 'CP', title: 'Copper', rate: 0.01 }
];

function renderCoins(c) {
    const cont = document.getElementById('char-coins-container');
    if (!cont) return;
    if (!c.coins) c.coins = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
    cont.innerHTML = '';

    COIN_TYPES.forEach(ct => {
        const box = document.createElement('div');
        box.className = 'coin-box coin-' + ct.key;

        const lab = document.createElement('div');
        lab.className = 'coin-label';
        lab.innerText = ct.label;
        lab.title = ct.title;
        box.appendChild(lab);

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.className = 'coin-input';
        input.value = c.coins[ct.key] || 0;
        input.addEventListener('change', () => {
            const v = parseInt(input.value, 10);
            c.coins[ct.key] = Number.isFinite(v) && v >= 0 ? v : 0;
            saveState();
            renderSelectedCharacter();
        });
        box.appendChild(input);

        cont.appendChild(box);
    });

    const total = COIN_TYPES.reduce((sum, ct) => sum + (c.coins[ct.key] || 0) * ct.rate, 0);
    const totalEl = document.getElementById('char-coin-total');
    if (totalEl) {
        totalEl.innerText = `${Math.round(total * 100) / 100} gp total`;
    }
}

/* ---------------- DM notes (server-side, PIN gated) ---------------- */

const dmState = { pin: null, dirty: false, saveTimer: null };

function dmShow(which) {
    ['dm-setup', 'dm-locked', 'dm-editor'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === which) ? 'block' : 'none';
    });
    const unlocked = which === 'dm-editor';
    ['btn-dm-save', 'btn-dm-lock', 'btn-dm-change-pin'].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.style.display = unlocked ? 'inline-flex' : 'none';
    });
}

async function dmApi(action, payload) {
    const res = await fetch(`/api/dm-notes/${action}`, {
        method: 'POST',
        headers: sessionHeaders(),
        body: JSON.stringify(payload || {})
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { ok: res.ok, status: res.status, data };
}

async function refreshDmGate() {
    // Players never use this panel (hidden in updateAdminToolsChrome); bail early.
    if (window.SeatSession && typeof SeatSession.get === 'function') {
        const seat = SeatSession.get();
        if (seat && seat.role && seat.role !== 'dm') {
            dmShow('dm-locked');
            const err = document.getElementById('dm-error');
            if (err) err.innerText = 'DM Notes are only available on the DM seat.';
            return;
        }
    }
    try {
        const res = await fetch('/api/dm-notes/status', {
            cache: 'no-store',
            headers: sessionHeaders()
        });
        if (res.status === 401) {
            dmShow('dm-locked');
            const err = document.getElementById('dm-error');
            if (err) err.innerText = 'Table locked — unlock the game board first.';
            return;
        }
        if (res.status === 403) {
            dmShow('dm-locked');
            const err = document.getElementById('dm-error');
            if (err) err.innerText = 'DM Notes require a DM seat.';
            return;
        }
        if (!res.ok) {
            dmShow('dm-locked');
            const err = document.getElementById('dm-error');
            if (err) err.innerText = 'Could not load DM notes status.';
            return;
        }
        const { configured } = await res.json();
        dmShow(configured ? 'dm-locked' : 'dm-setup');
    } catch (e) {
        // Offline / opened as a plain file: no server to hold private notes.
        dmShow('dm-locked');
        const err = document.getElementById('dm-error');
        if (err) err.innerText = 'Cannot reach the server, so DM notes are unavailable.';
    }
}

function dmSetStatus(msg, isError) {
    const el = document.getElementById('dm-status');
    if (!el) return;
    el.innerText = msg;
    el.className = 'dm-status' + (isError ? ' dm-status-error' : '');
}

function initDmPanel() {
    const setupBtn = document.getElementById('btn-dm-setup');
    const unlockBtn = document.getElementById('btn-dm-unlock');
    const saveBtn = document.getElementById('btn-dm-save');
    const lockBtn = document.getElementById('btn-dm-lock');
    const changeBtn = document.getElementById('btn-dm-change-pin');
    const textEl = document.getElementById('dm-notes-text');

    if (setupBtn) {
        setupBtn.addEventListener('click', async () => {
            const a = document.getElementById('dm-setup-pin').value;
            const b = document.getElementById('dm-setup-pin2').value;
            const err = document.getElementById('dm-setup-error');
            err.innerText = '';
            if (a.length < 4) { err.innerText = 'PIN must be at least 4 characters.'; return; }
            if (a !== b) { err.innerText = 'The two PINs do not match.'; return; }
            const r = await dmApi('setup', { pin: a });
            if (r.ok) {
                dmState.pin = a;
                textEl.value = '';
                dmShow('dm-editor');
                dmSetStatus('PIN set. These notes stay on the host server only.');
            } else {
                err.innerText = r.data.error || 'Could not set the PIN.';
            }
        });
    }

    if (unlockBtn) {
        const tryUnlock = async () => {
            const pin = document.getElementById('dm-pin').value;
            const err = document.getElementById('dm-error');
            err.innerText = '';
            const r = await dmApi('unlock', { pin });
            if (r.ok) {
                dmState.pin = pin;
                textEl.value = r.data.notes || '';
                document.getElementById('dm-pin').value = '';
                dmShow('dm-editor');
                dmSetStatus('Unlocked.');
            } else {
                err.innerText = r.data.error || 'Could not unlock.';
            }
        };
        unlockBtn.addEventListener('click', tryUnlock);
        const pinEl = document.getElementById('dm-pin');
        if (pinEl) {
            pinEl.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
        }
    }

    const doSave = async () => {
        if (!dmState.pin) return;
        const r = await dmApi('save', { pin: dmState.pin, notes: textEl.value });
        if (r.ok) {
            dmState.dirty = false;
            dmSetStatus('Saved ' + new Date().toLocaleTimeString());
        } else {
            dmSetStatus(r.data.error || 'Save failed.', true);
        }
    };

    if (saveBtn) saveBtn.addEventListener('click', doSave);

    if (textEl) {
        textEl.addEventListener('input', () => {
            dmState.dirty = true;
            dmSetStatus('Unsaved changes...');
            clearTimeout(dmState.saveTimer);
            dmState.saveTimer = setTimeout(doSave, 1500);   // autosave
        });
    }

    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            if (dmState.dirty && !confirm('You have unsaved changes. Lock anyway?')) return;
            dmState.pin = null;
            textEl.value = '';
            dmSetStatus('');
            dmShow('dm-locked');
        });
    }

    if (changeBtn) {
        changeBtn.addEventListener('click', async () => {
            const next = prompt('New DM PIN (at least 4 characters):');
            if (!next) return;
            if (next.length < 4) { alert('PIN must be at least 4 characters.'); return; }
            const r = await dmApi('change-pin', { pin: dmState.pin, newPin: next });
            if (r.ok) {
                dmState.pin = next;
                dmSetStatus('PIN changed.');
            } else {
                dmSetStatus(r.data.error || 'Could not change the PIN.', true);
            }
        });
    }

    // Re-lock whenever the DM navigates away from the panel.
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (item.dataset.target === 'panel-dm') {
                if (!dmState.pin) refreshDmGate();
            } else if (dmState.pin) {
                if (dmState.dirty) doSave();
                dmState.pin = null;
                if (textEl) textEl.value = '';
                dmShow('dm-locked');
            }
        });
    });

    refreshDmGate();
}

function initRestButtons() {
    const shortBtn = document.getElementById('btn-short-rest');
    const longBtn = document.getElementById('btn-long-rest');
    const addBtn = document.getElementById('btn-add-resource');

    const currentChar = () => {
        const active = getActiveCampaign();
        return active ? active.characters[state.activeCharacterId] : null;
    };

    if (shortBtn) {
        shortBtn.addEventListener('click', () => {
            const c = currentChar();
            if (!c) return;
            const notes = applyRest(c, 'short');
            saveState();
            renderAll();
            alert(`${c.name} takes a short rest.\n\n` +
                  (notes.length ? notes.join('\n') : 'Nothing needed restoring.') +
                  '\n\nAbilities set to "Manual" were left alone.');
        });
    }

    if (longBtn) {
        longBtn.addEventListener('click', () => {
            const c = currentChar();
            if (!c) return;
            if (!confirm(`Long rest for ${c.name}?\n\nThis restores HP to full, clears temp HP, refills every spell slot and resets all resources except those marked Manual.`)) return;
            const notes = applyRest(c, 'long');
            saveState();
            renderAll();
            alert(`${c.name} finishes a long rest.\n\n` + notes.join('\n'));
        });
    }

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const c = currentChar();
            if (!c) return;
            const name = prompt('Name of the ability or resource:');
            if (!name || !name.trim()) return;
            const max = parseInt(prompt('How many uses?', '1'), 10);
            if (!Number.isFinite(max) || max < 0) return;
            if (!Array.isArray(c.resources)) c.resources = [];
            c.resources.push({
                name: name.trim(),
                current: max,
                max: max,
                reset: 'long'
            });
            saveState();
            renderSelectedCharacter();
        });
    }
}

function rollForCharacter(charName, checkName, modStr) {
    const d20 = rollDie(20);
    const mod = parseInt(modStr) || 0;
    const total = d20 + mod;
    
    let critique = '';
    if (d20 === 20) critique = ' (CRITICAL SUCCESS!)';
    if (d20 === 1) critique = ' (CRITICAL FAILURE!)';
    
    logRoll(charName, checkName, total, `Rolled d20: Natural ${d20} + ${mod} modifier${critique}`, d20);
    switchToCombatPanel();
}

function switchToCombatPanel() {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));
    
    const navCombat = document.querySelector('.nav-item[data-target="panel-combat"]');
    if (navCombat) navCombat.classList.add('active');
    
    const panelCombat = document.getElementById('panel-combat');
    if (panelCombat) panelCombat.classList.add('active');
    
    renderInitiativeList();
    renderRollHistory();
}

const SKILL_ABILITIES = {
    acrobatics: 'DEX', animalHandling: 'WIS', arcana: 'INT', athletics: 'STR',
    deception: 'CHA', history: 'INT', insight: 'WIS', intimidation: 'CHA',
    investigation: 'INT', medicine: 'WIS', nature: 'INT', perception: 'WIS',
    performance: 'CHA', persuasion: 'CHA', religion: 'INT', sleightOfHand: 'DEX',
    stealth: 'DEX', survival: 'WIS'
};

const DEFAULT_CLASS_SAVES = {
    Artificer: ['CON', 'INT'], Barbarian: ['STR', 'CON'], Bard: ['DEX', 'CHA'],
    Cleric: ['WIS', 'CHA'], Druid: ['INT', 'WIS'], Fighter: ['STR', 'CON'],
    Monk: ['STR', 'DEX'], Paladin: ['WIS', 'CHA'], Ranger: ['STR', 'DEX'],
    Rogue: ['DEX', 'INT'], Sorcerer: ['CON', 'CHA'], Warlock: ['WIS', 'CHA'],
    Wizard: ['INT', 'WIS']
};

function signed(n) {
    return n >= 0 ? `+${n}` : `${n}`;
}

/**
 * One-time migration: older saves stored only the final skill/save totals with
 * no record of WHICH proficiencies produced them. Infer them once from the
 * current numbers, write the flags down, and never guess again.
 */
function ensureProficiencyFlags(c) {
    if (!c || !c.abilities) return;
    const prof = parseInt(c.proficiencyBonus) || 2;
    const modOf = (ab) => Math.floor(((c.abilities[ab] || {}).score - 10) / 2) || 0;

    // Prefer the authoritative flags shipped in data.js for known characters.
    // Inference is only a fallback for characters we have no reference for,
    // because a stored total can't distinguish proficiency from a misc bonus.
    let seed = null;
    try {
        if (typeof INITIAL_CHARACTER_DATA !== 'undefined') {
            seed = Object.values(INITIAL_CHARACTER_DATA)
                .find(s => s && s.name === c.name && s.skillProfs);
        }
    } catch (e) { /* seed data unavailable; fall through to inference */ }

    if (!c.saveProfs) {
        if (seed && seed.saveProfs) {
            c.saveProfs = [...seed.saveProfs];
        } else {
            const inferred = [];
            Object.keys(c.saves || {}).forEach(ab => {
                if ((parseInt(c.saves[ab]) || 0) - modOf(ab) >= prof) inferred.push(ab);
            });
            c.saveProfs = inferred.length
                ? inferred
                : (DEFAULT_CLASS_SAVES[(c.class || '').split(' ')[0]] || []);
        }
    }

    if (!c.skillMisc) {
        c.skillMisc = seed && seed.skillMisc ? { ...seed.skillMisc } : {};
        // Druid Primal Order (Magician) adds the WIS modifier to Arcana and Nature.
        if (!seed && (c.class || '').includes('Druid')) {
            c.skillMisc.arcana = 'WIS';
            c.skillMisc.nature = 'WIS';
        }
    }

    if (!c.skillProfs) {
        if (seed && seed.skillProfs) {
            c.skillProfs = { ...seed.skillProfs };
        } else {
            c.skillProfs = {};
            Object.keys(SKILL_ABILITIES).forEach(skill => {
                const base = modOf(SKILL_ABILITIES[skill]);
                const extra = c.skillMisc[skill] ? modOf(c.skillMisc[skill]) : 0;
                const diff = (parseInt((c.skills || {})[skill]) || 0) - base - extra;
                if (diff >= prof * 2) c.skillProfs[skill] = 'expert';
                else if (diff >= prof) c.skillProfs[skill] = 'prof';
            });
        }
    }

    (c.weapons || []).forEach(w => {
        if (!w.ability) {
            const ref = seed && (seed.weapons || []).find(x => x.name === w.name);
            w.ability = ref && ref.ability ? ref.ability : 'STR';
        }
    });

    if (!Array.isArray(c.resources)) {
        c.resources = seed && seed.resources
            ? JSON.parse(JSON.stringify(seed.resources))
            : [];
    }
}

/**
 * Recompute every derived number from the stored scores and proficiency flags.
 * Nothing here is inferred from previous output, so repeated recalculation and
 * levelling up stay stable.
 */
function recalculateCharacterModifiers(c) {
    ensureProficiencyFlags(c);

    const prof = parseInt(c.proficiencyBonus) || 2;
    const modOf = (ab) => Math.floor(((c.abilities[ab] || {}).score - 10) / 2) || 0;

    Object.keys(c.abilities).forEach(ab => {
        c.abilities[ab].mod = signed(modOf(ab));
    });

    Object.keys(c.saves || {}).forEach(ab => {
        c.saves[ab] = signed(modOf(ab) + (c.saveProfs.includes(ab) ? prof : 0));
    });

    Object.keys(SKILL_ABILITIES).forEach(skill => {
        const base = modOf(SKILL_ABILITIES[skill]);
        const flag = c.skillProfs[skill];
        const profPart = flag === 'expert' ? prof * 2 : flag === 'prof' ? prof : 0;
        const extra = c.skillMisc[skill] ? modOf(c.skillMisc[skill]) : 0;
        c.skills[skill] = signed(base + profPart + extra);
    });

    (c.weapons || []).forEach(w => {
        const magic = /\+(\d)/.test(w.name) ? parseInt(RegExp.$1) : 0;
        w.bonus = signed(modOf(w.ability || 'STR') + prof + magic);
    });
}

// ----------------------------------------------------
// 3. Dice Roller & Combat Tracker Controller
// ----------------------------------------------------
function initCombatPanel() {
    const diceBtns = document.querySelectorAll('.dice-btn');
    diceBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const sides = parseInt(btn.getAttribute('data-die'));
            rollDice(sides);
        });
    });
    
    document.getElementById('btn-next-turn').addEventListener('click', () => {
        if (!requireDmAction('advance combat turns')) return;
        nextCombatTurn();
    });
    
    document.getElementById('btn-reset-combat').addEventListener('click', () => {
        if (!requireDmAction('reset the combat tracker')) return;
        resetCombatTracker();
    });

    const sortBtn = document.getElementById('btn-sort-init');
    if (sortBtn) {
        sortBtn.addEventListener('click', () => {
            sortCombatantsByInitiative();
            renderInitiativeList();
            saveCombatNow();
        });
    }
    
    document.getElementById('btn-add-combatant-modal').addEventListener('click', () => {
        openAddCombatantModal();
    });
}

/** Don't let poll stomp combat for a few seconds after a local combat edit. */
let _suppressCombatSyncUntil = 0;
function markCombatLocalEdit(ms) {
    _suppressCombatSyncUntil = Date.now() + (typeof ms === 'number' ? ms : 8000);
}

/**
 * Persist combat tracker immediately (not only via debounced full smartSave).
 * Prevents Round 1 flash → poll restore Round 2.
 */
async function saveCombatNow() {
    markCombatLocalEdit(10000);
    saveLocalUi();
    try {
        localStorage.setItem('dnd_campaign_state', JSON.stringify({
            campaigns: state.campaigns,
            activeCampaignId: state.activeCampaignId,
            combatants: state.combatants,
            activeCombatantIndex: state.activeCombatantIndex,
            combatRound: state.combatRound,
            rollHistory: state.rollHistory
        }));
    } catch (e) { /* ignore */ }

    if (!IS_SERVER_MODE) return true;

    const camp = getActiveCampaign();
    if (!camp) return false;
    const cid = camp.id;
    const revKey = 'combat:' + cid;
    let baseRevision = state.revisions && state.revisions[revKey];

    setSyncStatus('Saving combat…', 'warn');
    try {
        // Refresh revision if missing
        if (typeof baseRevision !== 'number') {
            await loadState();
            // loadState may have been suppressed for combat fields
            baseRevision = state.revisions && state.revisions[revKey];
            if (typeof baseRevision !== 'number') baseRevision = 0;
        }

        const attempt = async (rev) => {
            const res = await fetch('/api/combat/' + encodeURIComponent(cid), {
                method: 'PUT',
                headers: sessionHeaders(),
                body: JSON.stringify({
                    baseRevision: rev,
                    data: {
                        combatants: state.combatants,
                        activeCombatantIndex: state.activeCombatantIndex,
                        combatRound: state.combatRound,
                        rollHistory: state.rollHistory
                    }
                })
            });
            const data = await res.json().catch(() => ({}));
            return { res, data };
        };

        let { res, data } = await attempt(baseRevision);
        if (res.status === 409 && typeof data.currentRevision === 'number') {
            // Retry once with server revision but OUR combat payload
            ({ res, data } = await attempt(data.currentRevision));
        }
        if (res.status === 404 || (res.status === 409 && baseRevision === 0)) {
            // No combat doc yet — full save path
            await saveStateToServer();
            markCombatLocalEdit(3000);
            setSyncStatus('Saved', 'ok');
            return true;
        }
        if (!res.ok) {
            console.error('Combat save failed', data);
            setSyncStatus('Combat save failed', 'err');
            // Keep local combat visible
            markCombatLocalEdit(15000);
            return false;
        }
        if (typeof data.revision === 'number') {
            if (!state.revisions) state.revisions = {};
            state.revisions[revKey] = data.revision;
        }
        markCombatLocalEdit(4000);
        setSyncStatus('Combat saved', 'ok');
        return true;
    } catch (e) {
        console.error(e);
        setSyncStatus('Offline', 'err');
        markCombatLocalEdit(15000);
        return false;
    }
}

function sortCombatantsByInitiative() {
    if (!state.combatants || state.combatants.length < 2) return;
    const active = state.combatants[state.activeCombatantIndex];
    state.combatants.sort((a, b) => {
        const ai = parseInt(a.initiative, 10);
        const bi = parseInt(b.initiative, 10);
        const av = Number.isFinite(ai) ? ai : 0;
        const bv = Number.isFinite(bi) ? bi : 0;
        if (bv !== av) return bv - av;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });
    if (active) {
        const i = state.combatants.indexOf(active);
        state.activeCombatantIndex = i >= 0 ? i : 0;
    }
}

function moveCombatant(idx, dir) {
    const arr = state.combatants;
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    const activeName = arr[state.activeCombatantIndex] && arr[state.activeCombatantIndex].name;
    const tmp = arr[idx];
    arr[idx] = arr[j];
    arr[j] = tmp;
    // Keep "whose turn" on the same creature when possible
    if (activeName) {
        const ni = arr.findIndex(c => c.name === activeName);
        if (ni >= 0) state.activeCombatantIndex = ni;
    }
    renderInitiativeList();
    saveCombatNow();
}

function getDiceRollerName() {
    try {
        if (window.SeatSession && SeatSession.get()) {
            const seat = SeatSession.get();
            if (seat.role === 'dm') {
                return seat.label ? ('DM (' + seat.label + ')') : 'DM';
            }
            // Prefer character display name from campaign state
            const camp = typeof getActiveCampaign === 'function' ? getActiveCampaign() : null;
            const charId = seat.characterId;
            if (camp && camp.characters && charId && camp.characters[charId]) {
                const c = camp.characters[charId];
                const nm = c.name || charId;
                if (seat.label && seat.label !== nm && seat.label !== charId) {
                    return nm + ' (' + seat.label + ')';
                }
                if (c.player) return nm + ' (' + c.player + ')';
                return nm;
            }
            if (charId) {
                return seat.label ? (charId + ' (' + seat.label + ')') : charId;
            }
            if (seat.label) return seat.label;
        }
    } catch (e) { /* ignore */ }
    return 'Dice Tray';
}

function rollDie(sides) {
    return Math.floor(Math.random() * sides) + 1;
}

/** d2 / coin: 1 = Yes, 2 = No (True/False style). */
function formatDieFace(sides, n) {
    if (sides === 2) return n === 1 ? 'Yes' : 'No';
    return String(n);
}

function getDiceCount() {
    const el = document.getElementById('dice-count-val');
    let n = el ? parseInt(el.value, 10) : 1;
    if (!Number.isFinite(n) || n < 1) n = 1;
    if (n > 99) n = 99;
    return n;
}

function resetDiceCountToOne() {
    const el = document.getElementById('dice-count-val');
    if (el) el.value = '1';
}

function renderDiceFaces(faces, opts) {
    const facesEl = document.getElementById('dice-roll-faces');
    if (!facesEl) return;
    facesEl.innerHTML = '';
    const list = faces && faces.length ? faces : ['—'];
    list.forEach((face, i) => {
        const pill = document.createElement('span');
        pill.className = 'dice-face-pill';
        if (opts && opts.critIndexes && opts.critIndexes.has(i)) {
            pill.classList.add('crit-success');
        }
        if (opts && opts.failIndexes && opts.failIndexes.has(i)) {
            pill.classList.add('crit-fail');
        }
        pill.textContent = face;
        facesEl.appendChild(pill);
    });
}

function rollDice(sides) {
    const facesEl = document.getElementById('dice-roll-faces');
    const totalEl = document.getElementById('dice-roll-result');
    const detailEl = document.getElementById('dice-roll-detail');
    const modInput = document.getElementById('dice-mod-val');
    const modifier = parseInt(modInput.value, 10) || 0;
    const count = getDiceCount();
    const isCoin = sides === 2;
    const roller = getDiceRollerName();
    
    playDiceSound();
    
    // Clear prior result layout
    if (facesEl) {
        facesEl.classList.remove('dice-roll-animation');
        void facesEl.offsetWidth;
        facesEl.classList.add('dice-roll-animation');
    }
    if (totalEl) {
        totalEl.classList.remove('dice-roll-animation');
    }
    
    let counter = 0;
    const interval = setInterval(() => {
        // Spin preview: random faces
        const preview = [];
        for (let i = 0; i < count; i++) {
            preview.push(isCoin ? (Math.random() < 0.5 ? 'Yes' : 'No') : String(rollDie(sides)));
        }
        renderDiceFaces(preview);
        if (totalEl) totalEl.textContent = '…';
        counter++;
        if (counter > 10) {
            clearInterval(interval);
            
            const rolls = [];
            for (let i = 0; i < count; i++) rolls.push(rollDie(sides));
            const sum = rolls.reduce((a, b) => a + b, 0);
            const total = sum + modifier;
            const faces = rolls.map(r => formatDieFace(sides, r));
            const rollName = `${count}d${sides}`;

            const critIndexes = new Set();
            const failIndexes = new Set();
            if (sides === 20) {
                rolls.forEach((r, i) => {
                    if (r === 20) critIndexes.add(i);
                    if (r === 1) failIndexes.add(i);
                });
            }

            renderDiceFaces(faces, { critIndexes, failIndexes });

            // Sum line under the individual dice
            let totalLine;
            if (isCoin && count === 1) {
                totalLine = faces[0];
            } else if (isCoin) {
                const yes = rolls.filter(r => r === 1).length;
                const no = count - yes;
                totalLine = modifier !== 0
                    ? `${yes} Yes / ${no} No · sum ${sum}${modifier >= 0 ? ' + ' : ' − '}${Math.abs(modifier)} = ${total}`
                    : `${yes} Yes / ${no} No · sum ${sum}`;
            } else if (count === 1 && modifier === 0) {
                totalLine = `Total: ${total}`;
            } else if (modifier !== 0) {
                totalLine = `Total: ${sum} ${modifier >= 0 ? '+' : '−'} ${Math.abs(modifier)} = ${total}`;
            } else {
                totalLine = `Total: ${sum}`;
            }
            if (totalEl) {
                totalEl.textContent = totalLine;
                totalEl.classList.add('dice-roll-animation');
            }
            
            let detailText = `${roller} rolled ${rollName}` + (isCoin ? ' (coin)' : '');
            if (isCoin) {
                const yes = rolls.filter(r => r === 1).length;
                const no = count - yes;
                detailText += count === 1
                    ? `: ${faces[0]}`
                    : `: ${faces.join(', ')} → ${yes} Yes / ${no} No`;
            } else if (count === 1) {
                detailText += `: ${rolls[0]}`;
            } else {
                detailText += `: [${rolls.join(' + ')}] = ${sum}`;
            }
            if (modifier !== 0 && !(isCoin && count === 1 && false)) {
                detailText += ` ${modifier >= 0 ? '+' : '−'} ${Math.abs(modifier)} = ${total}`;
            }
            if (detailEl) detailEl.innerText = detailText;
            
            const critDie = sides === 20 && count === 1 ? rolls[0] : (sides === 20 ? Math.max(...rolls) : 10);
            const historyTotal = isCoin && count === 1 ? faces[0] : total;
            logRoll(roller, rollName + (isCoin ? ' (coin)' : ''), historyTotal, detailText, critDie);
            renderRollHistory();
            resetDiceCountToOne();
        }
    }, 40);
}

function logRoll(roller, rollName, total, detail, rawDieResult = 10) {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let type = 'normal';
    if (rollName.includes('d20') || rollName.includes('Check') || rollName.includes('Throw') || rollName.includes('Attack')) {
        if (rawDieResult === 20) type = 'crit-success';
        if (rawDieResult === 1) type = 'crit-fail';
    }
    
    state.rollHistory.unshift({
        id: Date.now(),
        roller: roller || getDiceRollerName(),
        rollName,
        total,
        detail,
        time: timestamp,
        type
    });
    
    if (state.rollHistory.length > 50) {
        state.rollHistory.pop();
    }
    
    saveState();
}

function renderRollHistory() {
    const list = document.getElementById('dice-history-list');
    list.innerHTML = '';
    
    if (state.rollHistory.length === 0) {
        list.innerHTML = '<p style="padding: 10px; color: var(--text-muted); font-style: italic; text-align: center;">No rolls recorded yet.</p>';
        return;
    }
    
    state.rollHistory.forEach(item => {
        const row = document.createElement('div');
        row.className = `history-item ${item.type || ''}`;
        const who = item.roller || 'Unknown';
        const what = item.rollName || 'Roll';
        const detail = item.detail || '';
        row.innerHTML = `
            <div class="history-main">
                <div class="history-who"><i class="fa-solid fa-user"></i> ${escapeHtml(String(who))}</div>
                <div class="history-what">
                    <span class="history-roll-name">${escapeHtml(String(what))}</span>
                    <span class="history-detail">${escapeHtml(String(detail))}</span>
                </div>
            </div>
            <div class="history-aside">
                <span class="history-total">${escapeHtml(String(item.total))}</span>
                <span class="history-time">${escapeHtml(String(item.time || ''))}</span>
            </div>
        `;
        list.appendChild(row);
    });
}

function renderInitiativeList() {
    const list = document.getElementById('combat-init-list');
    list.innerHTML = '';
    
    document.getElementById('combat-round').innerText = state.combatRound;
    
    if (state.combatants.length === 0) {
        const addHint = canUseDestructiveAdmin()
            ? "Roll checks on sheets or click 'Add Combatant' to start."
            : 'Initiative is empty. Only the DM can add combatants or advance turns.';
        list.innerHTML = `
            <div style="text-align: center; padding: 40px 10px; color: var(--text-muted); border: 1px dashed rgba(197, 160, 89, 0.2); border-radius: 6px;">
                <i class="fa-solid fa-people-group" style="font-size: 2rem; color: var(--border-gold-dim); margin-bottom: 10px;"></i>
                <p>Initiative list is empty.</p>
                <p style="font-size: 0.8rem; margin-top: 5px;">${addHint}</p>
            </div>
        `;
        return;
    }
    
    state.combatants.forEach((c, idx) => {
        const isActive = idx === state.activeCombatantIndex;
        const isDm = canUseDestructiveAdmin();
        const row = document.createElement('div');
        row.className = `init-row ${isActive ? 'active' : ''}`;
        if (c.isMonster) {
            row.style.borderLeft = '3px solid var(--accent-red)';
        }

        const initVal = (c.initiative == null || c.initiative === '') ? '' : c.initiative;
        const hpVal = formatCombatHpDisplay(c.hp);
        const maxHpVal = formatCombatHpDisplay(c.maxHp);
        
        row.innerHTML = `
            <div class="init-order-btns">
                <button type="button" class="map-ctrl-btn btn-init-up" data-index="${idx}" title="Move up in order" ${idx === 0 ? 'disabled' : ''}>
                    <i class="fa-solid fa-chevron-up"></i>
                </button>
                <button type="button" class="map-ctrl-btn btn-init-down" data-index="${idx}" title="Move down in order" ${idx >= state.combatants.length - 1 ? 'disabled' : ''}>
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
            </div>
            <div class="init-score-wrap" title="Edit initiative (optional)">
                <input type="number" class="init-score-input" value="${initVal}" placeholder="—" data-index="${idx}" aria-label="Initiative for ${escapeHtml(c.name || '')}">
            </div>
            <div class="init-name">${escapeHtml(c.name || '')} ${c.isMonster ? '<span style="font-size:0.7rem; color:var(--accent-red); font-weight:bold;">[NPC]</span>' : ''}</div>
            <div class="init-hp-tracker">
                <span style="font-size:0.75rem; color:var(--text-muted); margin-right:3px;">HP:</span>
                <input type="text" class="init-hp-val" value="${escapeHtml(hpVal)}" placeholder="??" title="Current HP (blank or ?? if unknown)" inputmode="numeric">
                <span style="color:var(--text-muted);">/</span>
                <span class="init-hp-max" style="font-size:0.85rem; color:var(--text-muted);">${escapeHtml(maxHpVal)}</span>
            </div>
            <div>
                <span class="active-conditions" id="conditions-${idx}"></span>
            </div>
            <div style="text-align: right;">
                ${isDm ? `<button type="button" class="map-ctrl-btn btn-delete-combatant" data-index="${idx}" style="color: var(--accent-red); border-color: transparent; background: transparent; padding: 0;" title="Remove from combat">
                    <i class="fa-solid fa-circle-minus"></i>
                </button>` : ''}
            </div>
        `;
        
        row.querySelector('.init-hp-val').addEventListener('change', (e) => {
            const n = parseOptionalCombatNumber(e.target.value);
            c.hp = n;
            e.target.value = formatCombatHpDisplay(n);
            // If max was unknown and we now have current, leave max as ?? unless already set
            saveCombatNow();
        });

        row.querySelector('.init-score-input').addEventListener('change', (e) => {
            const raw = String(e.target.value || '').trim();
            if (!raw) {
                c.initiative = null;
                e.target.value = '';
            } else {
                const n = parseInt(raw, 10);
                c.initiative = Number.isFinite(n) ? n : null;
                e.target.value = c.initiative == null ? '' : c.initiative;
            }
            saveCombatNow();
        });

        row.querySelector('.btn-init-up').addEventListener('click', (e) => {
            e.stopPropagation();
            moveCombatant(idx, -1);
        });
        row.querySelector('.btn-init-down').addEventListener('click', (e) => {
            e.stopPropagation();
            moveCombatant(idx, 1);
        });
        
        const delBtn = row.querySelector('.btn-delete-combatant');
        if (delBtn) {
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!requireDmAction('remove combatants from the turn tracker')) return;
                state.combatants.splice(idx, 1);
                if (state.activeCombatantIndex >= state.combatants.length) {
                    state.activeCombatantIndex = Math.max(0, state.combatants.length - 1);
                }
                renderInitiativeList();
                saveCombatNow();
            });
        }
        
        list.appendChild(row);
    });
}

function nextCombatTurn() {
    if (!canUseDestructiveAdmin()) return;
    if (state.combatants.length === 0) return;
    
    state.activeCombatantIndex++;
    if (state.activeCombatantIndex >= state.combatants.length) {
        state.activeCombatantIndex = 0;
        state.combatRound++;
    }
    
    renderInitiativeList();
    saveCombatNow();
}

function resetCombatTracker() {
    if (!canUseDestructiveAdmin()) {
        alert('Only the DM can reset the combat tracker.');
        return;
    }
    if (!confirm('Reset combat tracker?\n\n• Round → 1\n• Turn → first in list\n• Initiative scores → 0\n• Remove NPC/monster rows\n• Re-add all party characters (from character sheets)\n\nYou can edit initiative numbers and use ↑↓ to reorder after reset.')) {
        return;
    }
    state.combatRound = 1;
    state.activeCombatantIndex = 0;
    // Drop NPCs; keep nothing stale — rebuild PCs from party sheets
    state.combatants = (state.combatants || []).filter(c => !c.isMonster);
    ensureAllPartyOnTracker({ zeroInit: true, refreshHpFromSheet: true });
    // If campaign has no characters, still zero leftover PC-ish rows
    state.combatants.forEach(c => {
        if (!c.isMonster) c.initiative = 0;
    });
    renderInitiativeList();
    saveCombatNow().then(ok => {
        if (ok) setSyncStatus('Combat reset', 'ok');
    });
}

// ----------------------------------------------------
// 4. Session Logs Panel Controller
// ----------------------------------------------------
function initSessionLogsPanel() {
    document.getElementById('btn-new-log-modal').addEventListener('click', () => {
        openNewSessionLogModal();
    });
}

/** Who is writing this note (seat character / DM label). */
function getSessionActorName() {
    const n = typeof getDiceRollerName === 'function' ? getDiceRollerName() : '';
    if (n && n !== 'Dice Tray') return n;
    try {
        if (window.SeatSession && SeatSession.get()) {
            const seat = SeatSession.get();
            if (seat.role === 'dm') return seat.label ? ('DM (' + seat.label + ')') : 'DM';
            if (seat.characterId) return seat.label || seat.characterId;
            if (seat.label) return seat.label;
        }
    } catch (e) { /* ignore */ }
    return 'Guest';
}

function formatSessionAdditionTime(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return String(iso);
        return d.toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit'
        });
    } catch (e) {
        return String(iso);
    }
}

function renderSessionLogBody(log) {
    const host = document.getElementById('session-detail-content');
    if (!host) return;
    host.innerHTML = '';

    const main = document.createElement('div');
    main.className = 'session-log-main';
    const mainText = (log && log.content) ? String(log.content) : '';
    if (mainText) {
        main.innerText = mainText;
    } else {
        main.classList.add('session-log-main-empty');
        main.innerText = '(No main DM notes yet.)';
    }
    host.appendChild(main);

    const adds = (log && Array.isArray(log.additions)) ? log.additions : [];
    if (!adds.length) return;

    const head = document.createElement('div');
    head.className = 'session-log-additions-heading';
    head.textContent = 'Party additions';
    host.appendChild(head);

    // Show oldest first so the log reads top→bottom
    const ordered = adds.slice().sort((a, b) => {
        const ta = a && a.at ? Date.parse(a.at) : (a && a.id) || 0;
        const tb = b && b.at ? Date.parse(b.at) : (b && b.id) || 0;
        return ta - tb;
    });
    ordered.forEach(a => {
        const block = document.createElement('div');
        block.className = 'session-log-addition';
        const meta = document.createElement('div');
        meta.className = 'session-log-addition-meta';
        const by = document.createElement('strong');
        by.textContent = (a && a.by) ? String(a.by) : 'Someone';
        meta.appendChild(by);
        const when = document.createElement('span');
        when.textContent = ' · ' + formatSessionAdditionTime(a && a.at);
        meta.appendChild(when);
        block.appendChild(meta);
        const text = document.createElement('div');
        text.className = 'session-log-addition-text';
        text.innerText = (a && a.text) ? String(a.text) : '';
        block.appendChild(text);
        host.appendChild(block);
    });
}

function renderSessionLogsList() {
    const active = getActiveCampaign();
    if (!active) return;
    
    const list = document.getElementById('session-logs-list');
    list.innerHTML = '';
    
    if (!active.sessionLogs || active.sessionLogs.length === 0) {
        list.innerHTML = '<p style="padding: 10px; color: var(--text-muted); font-style: italic;">No session logs recorded.</p>';
        return;
    }
    
    const sorted = [...active.sessionLogs].sort((a,b) => b.id - a.id);
    let activeLog = null;
    
    sorted.forEach((log, index) => {
        const item = document.createElement('div');
        const selectedId = document.getElementById('session-edit-id').value;
        const isSelected = selectedId == log.id;
        const isActive = index === 0 && !selectedId;
        
        item.className = `session-list-item ${isSelected || isActive ? 'active' : ''}`;
        
        if (isSelected || isActive) {
            activeLog = log;
        }

        const addCount = Array.isArray(log.additions) ? log.additions.length : 0;
        const addHint = addCount
            ? `<p style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;"><i class="fa-solid fa-comments"></i> ${addCount} addition${addCount === 1 ? '' : 's'}</p>`
            : '';
        
        item.innerHTML = `
            <h4>${escapeHtml(log.title || 'Untitled')}</h4>
            <p class="date"><i class="fa-solid fa-calendar-days"></i> ${escapeHtml(log.date || '')}</p>
            <p style="font-size:0.8rem; color:var(--text-muted); margin-top:5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(log.summary || '')}</p>
            ${addHint}
        `;
        
        item.addEventListener('click', () => {
            document.querySelectorAll('.session-list-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            displaySessionDetail(log);
        });
        
        list.appendChild(item);
    });
    
    if (activeLog) {
        displaySessionDetail(activeLog);
    }
}

function displaySessionDetail(log) {
    const active = getActiveCampaign();
    if (!log) return;
    
    document.getElementById('session-edit-id').value = log.id;
    document.getElementById('session-detail-title').innerText = log.title || 'Untitled';
    document.getElementById('session-detail-date').innerHTML = `<i class="fa-solid fa-calendar-days"></i> Play Date: ${escapeHtml(log.date || '')}`;
    document.getElementById('session-detail-summary').innerText = log.summary || '';
    renderSessionLogBody(log);
    
    document.getElementById('session-detail-actions').style.display = 'flex';
    updateSessionLogChrome();
    
    document.getElementById('btn-edit-session').onclick = () => {
        openEditSessionLogModal(log);
    };

    const addBtn = document.getElementById('btn-add-to-session');
    if (addBtn) {
        addBtn.onclick = () => {
            openAddToSessionLogModal(log);
        };
    }
    
    const delBtn = document.getElementById('btn-delete-session');
    if (delBtn) {
        const isDm = canUseDestructiveAdmin();
        delBtn.style.display = isDm ? '' : 'none';
        delBtn.disabled = !isDm;
        delBtn.onclick = () => {
            if (!requireDmAction('delete session logs')) return;
            if (confirm(`Are you sure you want to delete session "${log.title}"?`)) {
                if (!active) return;
                active.sessionLogs = (active.sessionLogs || []).filter(s => s.id !== log.id);
                saveState();
                document.getElementById('session-edit-id').value = '';
                document.getElementById('session-detail-title').innerText = 'Select a Session';
                document.getElementById('session-detail-date').innerText = '';
                document.getElementById('session-detail-summary').innerText = '';
                const contentEl = document.getElementById('session-detail-content');
                if (contentEl) contentEl.innerText = 'Click on a session log from the left sidebar to view notes and party additions.';
                document.getElementById('session-detail-actions').style.display = 'none';
                renderSessionLogsList();
            }
        };
    }
}

// ----------------------------------------------------
// 5. Modals Management & Event Listeners
// ----------------------------------------------------
function initModals() {
    const closeBtns = document.querySelectorAll('.close-modal');
    closeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal-overlay').forEach(el => el.style.display = 'none');
            state.isAddingMarker = false;
            const markerBtn = document.getElementById('btn-add-marker-modal');
            if (markerBtn) {
                markerBtn.innerHTML = '<i class="fa-solid fa-map-pin"></i> Add Location Pin';
                markerBtn.classList.remove('btn-dnd-success');
            }
        });
    });
    
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.style.display = 'none';
                state.isAddingMarker = false;
                const markerBtn = document.getElementById('btn-add-marker-modal');
                if (markerBtn) {
                    markerBtn.innerHTML = '<i class="fa-solid fa-map-pin"></i> Add Location Pin';
                    markerBtn.classList.remove('btn-dnd-success');
                }
            }
        });
    });

    // Save Character Specs
    document.getElementById('btn-save-char-specs').addEventListener('click', () => {
        const active = getActiveCampaign();
        const id = document.getElementById('edit-char-id').value;
        const c = active.characters[id];
        if (!c) return;
        
        c.level = parseInt(document.getElementById('edit-char-level').value) || 1;
        c.xp = document.getElementById('edit-char-xp').value;
        c.hp.max = parseInt(document.getElementById('edit-char-hp-max').value) || 10;
        if (c.hp.current > c.hp.max) c.hp.current = c.hp.max;
        
        c.ac = parseInt(document.getElementById('edit-char-ac').value) || 10;
        c.species = document.getElementById('edit-char-species').value.trim();
        c.background = document.getElementById('edit-char-background').value.trim();
        c.class = document.getElementById('edit-char-class').value.trim();
        c.subclass = document.getElementById('edit-char-subclass').value.trim();
        c.equipment = document.getElementById('edit-char-equipment').value;
        
        c.abilities.STR.score = parseInt(document.getElementById('edit-char-str').value) || 10;
        c.abilities.DEX.score = parseInt(document.getElementById('edit-char-dex').value) || 10;
        c.abilities.CON.score = parseInt(document.getElementById('edit-char-con').value) || 10;
        c.abilities.INT.score = parseInt(document.getElementById('edit-char-int').value) || 10;
        c.abilities.WIS.score = parseInt(document.getElementById('edit-char-wis').value) || 10;
        c.abilities.CHA.score = parseInt(document.getElementById('edit-char-cha').value) || 10;
        
        recalculateCharacterModifiers(c);
        c.initiative = c.abilities.DEX.mod;
        
        const trackerChar = state.combatants.find(cb => cb.name === c.name);
        if (trackerChar) {
            trackerChar.maxHp = c.hp.max;
            if (trackerChar.hp > c.hp.max) trackerChar.hp = c.hp.max;
        }
        
        saveState();
        renderSelectedCharacter();
        renderCharacterTabs();
        document.getElementById('modal-edit-char').style.display = 'none';
        
        logRoll(c.name, "Level Up / Spec Edit", c.level, `Updated specs and recalculated all modifiers.`);
    });

    // Save HP Adjustments
    document.getElementById('btn-apply-hp').addEventListener('click', () => {
        const active = getActiveCampaign();
        const action = document.getElementById('hp-action-type').value;
        const amount = parseInt(document.getElementById('hp-amount').value) || 0;
        const c = active.characters[state.activeCharacterId];
        if (!c || amount <= 0) return;
        
        if (action === 'damage') {
            if (c.hp.temp > 0) {
                if (c.hp.temp >= amount) {
                    c.hp.temp -= amount;
                    logRoll(c.name, "Took Damage", amount, `Absorbed fully by Temp HP. Remaining Temp HP: ${c.hp.temp}`);
                } else {
                    const remainingDamage = amount - c.hp.temp;
                    c.hp.temp = 0;
                    c.hp.current = Math.max(0, c.hp.current - remainingDamage);
                    logRoll(c.name, "Took Damage", amount, `Absorbed ${amount - remainingDamage} by Temp HP, took ${remainingDamage} to main HP. Current HP: ${c.hp.current}`);
                }
            } else {
                c.hp.current = Math.max(0, c.hp.current - amount);
                logRoll(c.name, "Took Damage", amount, `Took ${amount} damage. Current HP: ${c.hp.current}`);
            }
        } else if (action === 'heal') {
            const isTemp = document.getElementById('hp-is-temp').checked;
            if (isTemp) {
                c.hp.temp = Math.max(c.hp.temp || 0, amount);
                logRoll(c.name, "Gained Temp HP", amount, `Gained ${amount} Temporary HP. Current Temp HP: ${c.hp.temp}`);
            } else {
                c.hp.current = Math.min(c.hp.max, c.hp.current + amount);
                logRoll(c.name, "Healed HP", amount, `Regained ${amount} HP. Current HP: ${c.hp.current}`);
            }
        }
        
        const trackerChar = state.combatants.find(cb => cb.name === c.name);
        if (trackerChar) {
            trackerChar.hp = c.hp.current;
        }
        
        saveState();
        renderSelectedCharacter();
        document.getElementById('modal-adjust-hp').style.display = 'none';
    });

    // Save Map Pin
    document.getElementById('btn-save-marker').addEventListener('click', () => {
        const active = getActiveCampaign();
        const id = document.getElementById('marker-edit-id').value;
        const name = document.getElementById('marker-name-input').value.trim();
        const type = document.getElementById('marker-type-input').value;
        const description = document.getElementById('marker-desc-input').value.trim();
        
        if (!name) {
            alert('Please enter a location name.');
            return;
        }
        
        if (id) {
            const marker = active.mapMarkers.find(m => m.id == id);
            if (marker) {
                marker.name = name;
                marker.type = type;
                marker.description = description;
            }
        } else {
            const x = parseInt(document.getElementById('marker-coord-x').value);
            const y = parseInt(document.getElementById('marker-coord-y').value);
            
            const newMarker = {
                id: Date.now(),
                name,
                type,
                x,
                y,
                description
            };
            active.mapMarkers.push(newMarker);
        }
        
        saveState();
        renderMapMarkers();
        document.getElementById('modal-map-marker').style.display = 'none';
        
        const activeId = id ? parseInt(id) : active.mapMarkers[active.mapMarkers.length - 1].id;
        const marker = active.mapMarkers.find(m => m.id == activeId);
        showMarkerDetails(marker);
    });

    // Save Combatant (Initiative)
    document.getElementById('btn-save-combatant').addEventListener('click', () => {
        if (!requireDmAction('add combatants')) return;
        const name = document.getElementById('init-name-input').value.trim();
        const initRaw = document.getElementById('init-score-input').value;
        const hpRaw = document.getElementById('init-hp-input').value;
        const isMonster = document.getElementById('init-is-monster').checked;
        
        if (!name) {
            alert('Please enter a combatant name.');
            return;
        }

        const initiative = parseOptionalCombatNumber(initRaw);
        const hp = parseOptionalCombatNumber(hpRaw);
        // maxHp unknown unless HP was provided (then same as current until edited)
        const maxHp = hp;
        
        state.combatants.push({
            name,
            initiative,
            hp,
            maxHp,
            isMonster: !!isMonster,
            characterId: null
        });
        
        sortInitiativeList();
        renderInitiativeList();
        document.getElementById('modal-add-combatant').style.display = 'none';
        saveCombatNow();
    });

    // Save Session Log (DM write/edit only)
    document.getElementById('btn-save-session').addEventListener('click', () => {
        if (!requireDmAction('write or edit session logs')) return;
        const active = getActiveCampaign();
        if (!active) return;
        if (!Array.isArray(active.sessionLogs)) active.sessionLogs = [];
        const id = document.getElementById('session-edit-id').value;
        const title = document.getElementById('session-title-input').value.trim();
        const date = document.getElementById('session-date-input').value;
        const summary = document.getElementById('session-summary-input').value.trim();
        const content = document.getElementById('session-content-input').value.trim();
        
        if (!title || !date) {
            alert('Please enter a title and date.');
            return;
        }
        
        if (id && active.sessionLogs.some(s => s.id == id)) {
            const log = active.sessionLogs.find(s => s.id == id);
            log.title = title;
            log.date = date;
            log.summary = summary;
            log.content = content;
            // Preserve log.additions — players' entries are not part of this form
            if (!Array.isArray(log.additions)) log.additions = [];
        } else {
            const newLog = {
                id: Date.now(),
                title,
                date,
                summary,
                content,
                additions: [],
                createdBy: getSessionActorName(),
                createdAt: new Date().toISOString()
            };
            active.sessionLogs.push(newLog);
            document.getElementById('session-edit-id').value = newLog.id;
        }
        
        saveState();
        renderSessionLogsList();
        document.getElementById('modal-session-log').style.display = 'none';
    });

    // Player/DM append to an existing session log
    const saveAddBtn = document.getElementById('btn-save-session-add');
    if (saveAddBtn) {
        saveAddBtn.addEventListener('click', () => {
            const active = getActiveCampaign();
            if (!active) return;
            if (!Array.isArray(active.sessionLogs)) active.sessionLogs = [];
            const logId = document.getElementById('session-add-log-id').value;
            const text = document.getElementById('session-add-text').value.trim();
            if (!text) {
                alert('Write a note before adding it to the log.');
                return;
            }
            const log = active.sessionLogs.find(s => String(s.id) === String(logId));
            if (!log) {
                alert('Session log not found. Select a session and try again.');
                return;
            }
            if (!Array.isArray(log.additions)) log.additions = [];
            const by = getSessionActorName();
            log.additions.push({
                id: Date.now(),
                at: new Date().toISOString(),
                by,
                text
            });
            saveState();
            document.getElementById('modal-session-add').style.display = 'none';
            document.getElementById('session-add-text').value = '';
            document.getElementById('session-edit-id').value = log.id;
            renderSessionLogsList();
            displaySessionDetail(log);
        });
    }
}

function openEditCharSpecsModal() {
    const active = getActiveCampaign();
    const c = active.characters[state.activeCharacterId];
    if (!c) return;

    // DM must lock the open sheet before editing specs
    if (window.SeatSession && SeatSession.isDm()) {
        const charId = state.activeCharacterId;
        const locks =
            (state.dmEditLocks && state.dmEditLocks[charId]) ||
            (state.locks && state.locks[charId]) ||
            null;
        if (!(locks && locks.at)) {
            alert('Lock This Sheet first, then edit character specs.');
            return;
        }
    }
    
    document.getElementById('edit-char-id').value = state.activeCharacterId;
    document.getElementById('edit-char-level').value = c.level;
    document.getElementById('edit-char-xp').value = c.xp || '0';
    document.getElementById('edit-char-hp-max').value = c.hp.max;
    document.getElementById('edit-char-ac').value = c.ac;
    document.getElementById('edit-char-species').value = c.species || '';
    document.getElementById('edit-char-background').value = c.background || '';
    document.getElementById('edit-char-class').value = c.class || '';
    document.getElementById('edit-char-subclass').value = c.subclass || '';
    const equipTa = document.getElementById('edit-char-equipment');
    equipTa.value = c.equipment || '';
    
    document.getElementById('edit-char-str').value = c.abilities.STR.score;
    document.getElementById('edit-char-dex').value = c.abilities.DEX.score;
    document.getElementById('edit-char-con').value = c.abilities.CON.score;
    document.getElementById('edit-char-int').value = c.abilities.INT.score;
    document.getElementById('edit-char-wis').value = c.abilities.WIS.score;
    document.getElementById('edit-char-cha').value = c.abilities.CHA.score;
    
    document.getElementById('modal-edit-char').style.display = 'flex';
    // Measure only after the modal is visible — hidden nodes report scrollHeight ~ 0
    requestAnimationFrame(() => {
        fitTextareaInScrollHost(equipTa);
        requestAnimationFrame(() => fitTextareaInScrollHost(equipTa));
    });
}

/** Grow textarea height so parent .textarea-scroll-host owns the scrollbar (arrow cursor). */
function fitTextareaInScrollHost(ta) {
    if (!ta) return;
    const host = ta.closest('.textarea-scroll-host');
    // Reset so scrollHeight reflects full content
    ta.style.height = '0px';
    const full = ta.scrollHeight;
    const hostH = host ? host.clientHeight : 0;
    // At least fill the host; grow beyond so the HOST scrolls when content is long
    const next = Math.max(hostH || 104, full);
    ta.style.height = next + 'px';
}

function bindTextareaScrollHosts() {
    document.querySelectorAll('.textarea-scroll-host textarea').forEach(ta => {
        if (ta.dataset.scrollHostBound) return;
        ta.dataset.scrollHostBound = '1';
        ta.addEventListener('input', () => fitTextareaInScrollHost(ta));
    });
}

function openHPModal(type) {
    const active = getActiveCampaign();
    const c = active.characters[state.activeCharacterId];
    if (!c) return;
    
    document.getElementById('hp-action-type').value = type;
    document.getElementById('hp-modal-title').innerText = type === 'damage' ? 'Apply Damage' : 'Apply Healing';
    
    const applyBtn = document.getElementById('btn-apply-hp');
    applyBtn.innerText = type === 'damage' ? 'Damage' : 'Heal';
    applyBtn.className = type === 'damage' ? 'btn-dnd btn-dnd-primary' : 'btn-dnd btn-dnd-success';
    
    const tempGroup = document.getElementById('temp-hp-group');
    tempGroup.style.display = type === 'heal' ? 'block' : 'none';
    document.getElementById('hp-is-temp').checked = false;
    
    document.getElementById('hp-amount').value = 5;
    
    document.getElementById('modal-adjust-hp').style.display = 'flex';
}

function openAddMarkerModal(x, y) {
    document.getElementById('marker-edit-id').value = '';
    document.getElementById('marker-coord-x').value = x;
    document.getElementById('marker-coord-y').value = y;
    
    document.getElementById('marker-modal-title').innerText = 'Add Location Pin';
    document.getElementById('marker-name-input').value = '';
    document.getElementById('marker-type-input').value = 'town';
    document.getElementById('marker-desc-input').value = '';
    
    document.getElementById('marker-coord-display').innerText = `Coordinates: X:${x}, Y:${y}`;
    
    document.getElementById('modal-map-marker').style.display = 'flex';
}

function openEditMarkerModal(marker) {
    document.getElementById('marker-edit-id').value = marker.id;
    document.getElementById('marker-coord-x').value = marker.x;
    document.getElementById('marker-coord-y').value = marker.y;
    
    document.getElementById('marker-modal-title').innerText = 'Edit Location Pin';
    document.getElementById('marker-name-input').value = marker.name;
    document.getElementById('marker-type-input').value = marker.type || 'town';
    document.getElementById('marker-desc-input').value = marker.description || '';
    
    document.getElementById('marker-coord-display').innerText = `Coordinates: X:${marker.x}, Y:${marker.y}`;
    
    document.getElementById('modal-map-marker').style.display = 'flex';
}

function openNewSessionLogModal() {
    if (!requireDmAction('write a new session log')) return;
    const active = getActiveCampaign();
    if (!active) {
        alert('Create a campaign first.');
        return;
    }
    if (!Array.isArray(active.sessionLogs)) active.sessionLogs = [];
    document.getElementById('session-edit-id').value = '';
    document.getElementById('session-modal-title').innerText = 'Write New Session Log';
    
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('session-title-input').value = `Session ${active.sessionLogs.length + 1}: `;
    document.getElementById('session-date-input').value = today;
    document.getElementById('session-summary-input').value = '';
    document.getElementById('session-content-input').value = '';
    
    document.getElementById('modal-session-log').style.display = 'flex';
}

function openEditSessionLogModal(log) {
    if (!requireDmAction('edit session logs')) return;
    if (!log) return;
    document.getElementById('session-edit-id').value = log.id;
    document.getElementById('session-modal-title').innerText = 'Edit Session Log';
    
    document.getElementById('session-title-input').value = log.title || '';
    document.getElementById('session-date-input').value = log.date || '';
    document.getElementById('session-summary-input').value = log.summary || '';
    document.getElementById('session-content-input').value = log.content || '';
    
    document.getElementById('modal-session-log').style.display = 'flex';
}

function openAddToSessionLogModal(log) {
    if (!log || log.id == null) {
        alert('Select a session log first.');
        return;
    }
    const by = getSessionActorName();
    document.getElementById('session-add-log-id').value = log.id;
    document.getElementById('session-add-text').value = '';
    const attr = document.getElementById('session-add-attribution');
    if (attr) {
        attr.textContent = 'Signed as: ' + by + ' — this name is saved with your note.';
    }
    document.getElementById('modal-session-add').style.display = 'flex';
    setTimeout(() => {
        const ta = document.getElementById('session-add-text');
        if (ta) ta.focus();
    }, 40);
}

function sortInitiativeList() {
    state.combatants.sort((a, b) => combatInitSortValue(b.initiative) - combatInitSortValue(a.initiative));
}

// ----------------------------------------------------
// 6. Campaign Settings & Management Controls
// ----------------------------------------------------
function initCampaignSettings() {
    const mapFileInput = document.getElementById('campaign-map-file');
    
    // Read local image file as Base64 data URL
    mapFileInput.addEventListener('change', (e) => {
        if (!canUseDestructiveAdmin()) {
            alert('Only the DM can set the campaign map.');
            e.target.value = '';
            return;
        }
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                document.getElementById('campaign-map-input').value = evt.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Open Settings Modal (safe with zero campaigns)
    document.getElementById('btn-campaign-settings').addEventListener('click', () => {
        openCampaignSettingsModal();
    });
    
    // Save settings
    document.getElementById('btn-save-campaign-settings').addEventListener('click', () => {
        const id = document.getElementById('campaign-edit-id').value;
        const name = document.getElementById('campaign-name-input').value.trim();
        const mapImage = document.getElementById('campaign-map-input').value.trim();
        
        if (!id) {
            alert('No campaign selected. Create a campaign first.');
            return;
        }
        if (!name) {
            alert('Please enter a campaign name.');
            return;
        }
        
        const campaign = state.campaigns.find(c => c.id === id);
        if (campaign) {
            campaign.name = name;
            // Map image is shared table state — DM only
            if (canUseDestructiveAdmin()) {
                campaign.mapImage = mapImage || '';
            }
            saveState();
            renderCampaignSelector();
            renderAll();
            document.getElementById('modal-campaign-settings').style.display = 'none';
        }
    });
    
    // Create new campaign (blank slate) — modal + empty-state buttons (DM-only)
    const onCreate = async () => {
        if (!requireDmAction('add a campaign')) return;
        // First campaign on an empty table: use the Game Board name (no second naming prompt).
        // Extra campaigns (or rename) still go through Campaign Settings.
        const emptyTable = !state.campaigns || state.campaigns.length === 0;
        let name = '';
        if (emptyTable) {
            const g = (window.GameAccess && typeof GameAccess.get === 'function') ? GameAccess.get() : null;
            name = (g && g.gameName) || 'Main Campaign';
        } else {
            name = prompt('Enter a name for this additional campaign (adventure arc):');
            if (!name) return;
        }
        const ok = await createBlankCampaign(name);
        if (ok) {
            document.getElementById('modal-campaign-settings').style.display = 'none';
        }
    };
    document.getElementById('btn-create-campaign-new').addEventListener('click', onCreate);
    const emptyCreateBtn = document.getElementById('btn-create-campaign-empty');
    if (emptyCreateBtn) emptyCreateBtn.addEventListener('click', onCreate);
    const addCampaignBtn = document.getElementById('btn-add-campaign');
        if (addCampaignBtn) addCampaignBtn.addEventListener('click', onCreate);

        // Delete campaign — pick which one (map panel + settings) — DM-only
        const openDeleteCampaignPicker = () => {
            if (!requireDmAction('delete a campaign')) return;
            openDeleteCampaignModal();
        };
        const delCampaignBtn = document.getElementById('btn-delete-campaign');
        if (delCampaignBtn) delCampaignBtn.addEventListener('click', openDeleteCampaignPicker);
        document.getElementById('btn-delete-campaign-active').addEventListener('click', () => {
            if (!requireDmAction('delete a campaign')) return;
            document.getElementById('modal-campaign-settings').style.display = 'none';
            openDeleteCampaignModal();
        });
        const delConfirm = document.getElementById('btn-delete-campaign-confirm');
        if (delConfirm) {
            delConfirm.addEventListener('click', async () => {
                if (!requireDmAction('delete a campaign')) return;
                const sel = document.getElementById('delete-campaign-select');
                const id = sel && sel.value;
                if (!id) {
                    alert('Select a campaign to delete.');
                    return;
                }
                const camp = (state.campaigns || []).find(c => c.id === id);
                const label = camp ? camp.name : id;
                if (!confirm('Permanently delete campaign "' + label + '" only?\n\nCharacters, map pins, and logs for this campaign will be removed. Other campaigns are kept.')) {
                    return;
                }
                delConfirm.disabled = true;
                const ok = await deleteCampaignById(id);
                delConfirm.disabled = false;
                if (ok) {
                    const modal = document.getElementById('modal-delete-campaign');
                    if (modal) modal.style.display = 'none';
                }
            });
        }
    
        // Clone campaign (keeps characters & markers, resets logs) — DM-only
        document.getElementById('btn-clone-campaign-new').addEventListener('click', async () => {
            if (!requireDmAction('clone a campaign')) return;
            const active = getActiveCampaign();
            if (!active) {
                alert('No campaign to clone. Create a campaign first.');
                return;
            }
            const name = prompt(`Enter name for the cloned campaign:`, `${active.name} (Cloned)`);
            if (!name) return;
        
            const newId = 'campaign-' + Date.now();
            const clonedCampaign = {
                id: newId,
                name: name,
                mapImage: active.mapImage,
                characters: JSON.parse(JSON.stringify(active.characters)),
                sessionLogs: [],
                mapMarkers: JSON.parse(JSON.stringify(active.mapMarkers)),
                partyPosition: JSON.parse(JSON.stringify(active.partyPosition))
            };
        
            state.campaigns.push(clonedCampaign);
            state.activeCampaignId = newId;
        
            const charKeys = Object.keys(clonedCampaign.characters);
            state.activeCharacterId = charKeys.length > 0 ? charKeys[0] : '';
            state.combatants = initDefaultCombatants(clonedCampaign.characters);
            state.activeCombatantIndex = 0;
            state.combatRound = 1;
        
            if (IS_SERVER_MODE) {
                await saveStateToServer();
            } else {
                saveState();
            }
            renderCampaignSelector();
            renderAll();
            document.getElementById('modal-campaign-settings').style.display = 'none';
        
            logRoll('System', 'Clone Campaign', '-', `Cloned ${active.name} to ${name}`);
        });
    }

    function openDeleteCampaignModal() {
        if (!requireDmAction('delete a campaign')) return;
        const camps = state.campaigns || [];
        if (!camps.length) {
            alert('No campaigns to delete.');
            return;
        }
        const sel = document.getElementById('delete-campaign-select');
        if (!sel) return;
        sel.innerHTML = '';
        camps.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name + (c.id === state.activeCampaignId ? ' (current)' : '');
            if (c.id === state.activeCampaignId) opt.selected = true;
            sel.appendChild(opt);
        });
        const modal = document.getElementById('modal-delete-campaign');
        if (modal) modal.style.display = 'flex';
        setTimeout(() => sel.focus(), 40);
    }

    /**
     * Remove one campaign by id. Other campaigns stay.
     * Returns true if deleted and saved.
     */
    async function deleteCampaignById(campaignId) {
        if (!requireDmAction('delete a campaign')) return false;
        const id = String(campaignId || '');
        const camp = (state.campaigns || []).find(c => c.id === id);
        if (!camp) {
            alert('Campaign not found.');
            return false;
        }

        const wasActive = state.activeCampaignId === id;
        state.campaigns = state.campaigns.filter(c => c.id !== id);

        if (!state.campaigns.length) {
            state.activeCampaignId = '';
            state.activeCharacterId = null;
            state.combatants = [];
            state.activeCombatantIndex = 0;
            state.combatRound = 1;
        } else if (wasActive) {
            state.activeCampaignId = state.campaigns[0].id;
            const next = getActiveCampaign();
            const charKeys = next && next.characters ? Object.keys(next.characters) : [];
            state.activeCharacterId = charKeys.length ? charKeys[0] : null;
            state.combatants = next ? initDefaultCombatants(next.characters || {}) : [];
            state.activeCombatantIndex = 0;
            state.combatRound = 1;
        }

        let ok = true;
        if (IS_SERVER_MODE) {
            ok = await saveStateToServer();
            if (!ok) {
                alert('Could not save after deleting the campaign. Check sync status.');
            }
        } else {
            saveState();
        }

        renderCampaignSelector();
        renderAll();
        if (typeof logRoll === 'function') {
            logRoll('System', 'Delete Campaign', '-', 'Deleted campaign: ' + camp.name);
        }
        return ok;
    }

/** Starter character blob for a brand-new blank campaign. */
function buildStarterCharacter() {
    return {
        name: 'New Character',
        class: 'Fighter',
        level: 1,
        abilities: {
            STR: { score: 10, mod: '+0' },
            DEX: { score: 10, mod: '+0' },
            CON: { score: 10, mod: '+0' },
            INT: { score: 10, mod: '+0' },
            WIS: { score: 10, mod: '+0' },
            CHA: { score: 10, mod: '+0' }
        },
        saves: { STR: '+0', DEX: '+0', CON: '+0', INT: '+0', WIS: '+0', CHA: '+0' },
        skills: {},
        weapons: [],
        spells: [],
        equipment: '',
        backstory: '',
        hp: { current: 10, max: 10, temp: 0 },
        ac: 10,
        speed: '30 ft',
        initiative: '+0',
        passivePerception: 10,
        proficiencyBonus: '+2'
    };
}

function buildBlankCampaign(name) {
    const newId = 'campaign-' + Date.now();
    return {
        id: newId,
        name: String(name).trim(),
        mapImage: '',
        characters: { char1: buildStarterCharacter() },
        sessionLogs: [],
        mapMarkers: [],
        partyPosition: { x: 100, y: 100, lastUpdated: 'Campaign started' }
    };
}

/**
 * Create a blank campaign on an empty (or existing) table and persist fully.
 * Returns true if created.
 */
async function createBlankCampaign(name) {
    if (!requireDmAction('add a campaign')) return false;
    const trimmed = (name || '').trim();
    if (!trimmed) return false;

    const newCampaign = buildBlankCampaign(trimmed);
    state.campaigns.push(newCampaign);
    state.activeCampaignId = newCampaign.id;
    state.activeCharacterId = 'char1';
    state.combatants = initDefaultCombatants(newCampaign.characters);
    state.activeCombatantIndex = 0;
    state.combatRound = 1;

    // Full state write so split layout + revisions exist for the new campaign id
    if (IS_SERVER_MODE) {
        const ok = await saveStateToServer();
        if (!ok) {
            // Roll back local if server rejected
            state.campaigns = state.campaigns.filter(c => c.id !== newCampaign.id);
            state.activeCampaignId = state.campaigns[0] ? state.campaigns[0].id : '';
            alert('Could not save the new campaign to the server.');
            return false;
        }
    } else {
        saveState();
    }

    renderCampaignSelector();
    renderAll();
    logRoll('System', 'New Campaign', '-', `Created blank campaign: ${trimmed}`);
    return true;
}

function openCampaignSettingsModal() {
    const active = getActiveCampaign();
    const isDm = canUseDestructiveAdmin();
    const editId = document.getElementById('campaign-edit-id');
    const nameInput = document.getElementById('campaign-name-input');
    const mapInput = document.getElementById('campaign-map-input');
    const mapFileInput = document.getElementById('campaign-map-file');
    const saveBtn = document.getElementById('btn-save-campaign-settings');
    const cloneBtn = document.getElementById('btn-clone-campaign-new');
    const deleteBtn = document.getElementById('btn-delete-campaign-active');
    const createBtn = document.getElementById('btn-create-campaign-new');
    const titleEl = document.querySelector('#modal-campaign-settings .modal-header h3');

    if (mapFileInput) mapFileInput.value = '';

    if (!active) {
        if (editId) editId.value = '';
        if (nameInput) {
            nameInput.value = '';
            nameInput.placeholder = 'Create a campaign first (button below)';
            nameInput.disabled = true;
        }
        if (mapInput) {
            mapInput.value = '';
            mapInput.disabled = true;
        }
        if (saveBtn) saveBtn.disabled = true;
        if (cloneBtn) {
            cloneBtn.disabled = true;
            cloneBtn.style.display = isDm ? '' : 'none';
        }
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.style.display = isDm ? '' : 'none';
        }
        if (createBtn) {
            createBtn.style.display = isDm ? '' : 'none';
            createBtn.disabled = !isDm;
        }
        if (titleEl) titleEl.textContent = 'Campaign Settings — empty table';
    } else {
        if (editId) editId.value = active.id;
        if (nameInput) {
            nameInput.disabled = false;
            nameInput.placeholder = 'e.g., Curse of Strahd, My Homebrew';
            nameInput.value = active.name || '';
        }
        if (mapInput) {
            mapInput.disabled = false;
            mapInput.value = active.mapImage || '';
        }
        if (saveBtn) saveBtn.disabled = false;
        if (cloneBtn) {
            cloneBtn.disabled = !isDm;
            cloneBtn.style.display = isDm ? '' : 'none';
        }
        if (deleteBtn) {
            deleteBtn.disabled = !isDm;
            deleteBtn.style.display = isDm ? '' : 'none';
        }
        if (createBtn) {
            createBtn.style.display = isDm ? '' : 'none';
            createBtn.disabled = !isDm;
        }
        if (titleEl) titleEl.textContent = 'Campaign Settings';
    }

    document.getElementById('modal-campaign-settings').style.display = 'flex';
}

/** Map heading, party note, and empty-table overlay. Add/Delete campaign = DM only. */
function updateEmptyCampaignChrome() {
    const empty = !state.campaigns || state.campaigns.length === 0;
    const active = getActiveCampaign();
    const isDm = canUseDestructiveAdmin();
    const overlay = document.getElementById('empty-campaigns-overlay');
    const heading = document.getElementById('map-panel-heading');
    const sub = document.getElementById('map-panel-sub');
    const partyDesc = document.getElementById('party-loc-desc');
    const addMarker = document.getElementById('btn-add-marker-modal');
    const addCampaign = document.getElementById('btn-add-campaign');
    const delCampaign = document.getElementById('btn-delete-campaign');
    const emptyCreate = document.getElementById('btn-create-campaign-empty');
    const emptyNote = document.getElementById('empty-campaigns-dm-note');
    const select = document.getElementById('campaign-select');

    if (overlay) overlay.style.display = empty ? 'flex' : 'none';
    if (empty) {
        // Hide map-missing while empty-table card is up
        const missing = document.getElementById('map-missing-overlay');
        if (missing) missing.style.display = 'none';
        if (heading) heading.textContent = 'Campaign Map';
        if (sub) {
            const g = (window.GameAccess && typeof GameAccess.get === 'function') ? GameAccess.get() : null;
            const gName = (g && g.gameName) || 'this game';
            sub.textContent = isDm
                ? ('Game table “' + gName + '” is ready — start a campaign to add characters and a map.')
                : ('Game table “' + gName + '” — waiting for the DM to start a campaign.');
        }
        if (partyDesc) partyDesc.textContent = '—';
        if (addMarker) addMarker.disabled = true;
        // Empty table: Start campaign is DM-only
        if (addCampaign) addCampaign.style.display = 'none';
        if (delCampaign) delCampaign.style.display = 'none';
        if (emptyCreate) {
            emptyCreate.style.display = isDm ? '' : 'none';
            emptyCreate.disabled = !isDm;
            emptyCreate.title = isDm ? 'Start the first campaign' : 'Only the DM can start a campaign';
        }
        if (emptyNote) {
            emptyNote.style.display = isDm ? 'none' : 'block';
            emptyNote.textContent = 'Only the DM can start or add campaigns on this table.';
        }
        if (select) {
            select.innerHTML = '';
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '(no campaigns)';
            select.appendChild(opt);
            select.disabled = true;
        }
        return;
    }

    if (select) select.disabled = false;
    if (addMarker) addMarker.disabled = false;
    // Add / Delete Campaign: DM seat only (players never see these)
    if (addCampaign) {
        addCampaign.style.display = isDm ? '' : 'none';
        addCampaign.disabled = !isDm;
        addCampaign.title = isDm
            ? 'Add another campaign (adventure arc) on this game table'
            : 'Only the DM can add a campaign';
    }
    if (delCampaign) {
        delCampaign.style.display = isDm ? '' : 'none';
        delCampaign.disabled = !isDm;
        delCampaign.title = isDm
            ? 'Delete one campaign from this table'
            : 'Only the DM can delete a campaign';
    }
    if (emptyCreate) emptyCreate.style.display = 'none';
    if (emptyNote) emptyNote.style.display = 'none';
    if (heading) heading.textContent = (active && active.name) ? active.name : 'Campaign Map';
    if (sub) {
        sub.textContent = "Track the party's journey and pin notable locations. Drag the Shield token to move the party.";
    }
    if (partyDesc) {
        const note = active && active.partyPosition && active.partyPosition.lastUpdated;
        partyDesc.textContent = note || '—';
    }
}

function renderCampaignSelector() {
    const select = document.getElementById('campaign-select');
    if (!select) return;
    select.innerHTML = '';

    if (!state.campaigns || state.campaigns.length === 0) {
        updateEmptyCampaignChrome();
        return;
    }
    
    state.campaigns.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.innerText = c.name;
        opt.selected = c.id === state.activeCampaignId;
        select.appendChild(opt);
    });
    select.disabled = false;
    
    select.onchange = (e) => {
        state.activeCampaignId = e.target.value;
        const newCampaign = getActiveCampaign();
        if (!newCampaign) return;
        
        const charKeys = Object.keys(newCampaign.characters);
        state.activeCharacterId = charKeys.length > 0 ? charKeys[0] : '';
        state.combatants = initDefaultCombatants(newCampaign.characters);
        state.activeCombatantIndex = 0;
        state.combatRound = 1;
        
        saveState();
        renderAll();
        showMarkerDetails(null);
    };

    updateEmptyCampaignChrome();
}

// ----------------------------------------------------
// 7. JSON Import / Export & Reset Database (F4 safer)
// ----------------------------------------------------

/** Shared campaign document only (no seat chrome, revisions, locks, local UI). */
function buildSharedExportPayload() {
    return {
        exportedAt: new Date().toISOString(),
        schemaHint: 'beer-club-dnd-campaign-v1',
        campaigns: state.campaigns,
        activeCampaignId: state.activeCampaignId,
        combatants: state.combatants,
        activeCombatantIndex: state.activeCombatantIndex,
        combatRound: state.combatRound,
        rollHistory: state.rollHistory
    };
}

function canUseDestructiveAdmin() {
    // With seats: Import/Reset are DM-only. Without seat API, allow (offline/file open).
    if (!window.SeatSession || typeof SeatSession.get !== 'function') return true;
    const seat = SeatSession.get();
    if (!seat) return true;
    return seat.role === 'dm' || SeatSession.isDm();
}

/** Alert + bail unless DM seat (or no seat system / offline). */
function requireDmAction(what) {
    if (canUseDestructiveAdmin()) return true;
    alert('Only the DM can ' + (what || 'do that') + '.');
    return false;
}

/** Combat turn controls + session log DM tools + player Add to Log. */
function updateCombatAndSessionChrome() {
    const isDm = canUseDestructiveAdmin();
    const combatIds = [
        'btn-next-turn',
        'btn-reset-combat',
        'btn-add-combatant-modal'
    ];
    combatIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = isDm ? '' : 'none';
        el.disabled = !isDm;
        el.title = isDm ? '' : 'DM seat required';
    });
    updateSessionLogChrome();
    const combatHint = document.getElementById('combat-dm-tools-hint');
    if (combatHint) {
        combatHint.style.display = isDm ? 'none' : 'block';
        combatHint.textContent = isDm
            ? ''
            : 'View only: Next Turn, Reset, and Add Combatant are DM controls. You can still edit HP / initiative on rows if the DM allows table play.';
    }
}

/** Session logs: Write/Edit/Delete = DM; Add to Log = everyone (when a log is open). */
function updateSessionLogChrome() {
    const isDm = canUseDestructiveAdmin();
    const newBtn = document.getElementById('btn-new-log-modal');
    if (newBtn) {
        newBtn.style.display = isDm ? '' : 'none';
        newBtn.disabled = !isDm;
        newBtn.title = isDm
            ? 'Create a new session log'
            : 'Only the DM can write a new session log — use Add to Log on an existing session';
    }
    const editBtn = document.getElementById('btn-edit-session');
    if (editBtn) {
        editBtn.style.display = isDm ? '' : 'none';
        editBtn.disabled = !isDm;
        editBtn.title = isDm
            ? 'Edit title, date, summary, and main notes'
            : 'Only the DM can edit the main session log — use Add to Log';
    }
    const delLog = document.getElementById('btn-delete-session');
    if (delLog) {
        delLog.style.display = isDm ? '' : 'none';
        delLog.disabled = !isDm;
        delLog.title = isDm ? 'Delete this session log' : 'Only the DM can delete session logs';
    }
    const addBtn = document.getElementById('btn-add-to-session');
    if (addBtn) {
        // Visible whenever detail actions are shown (displaySessionDetail)
        addBtn.style.display = '';
        addBtn.disabled = false;
        addBtn.title = 'Append your note (signed as ' + getSessionActorName() + ')';
    }
}

function updateAdminToolsChrome() {
    const importBtn = document.getElementById('btn-import-trigger');
    const resetBtn = document.getElementById('btn-reset-data');
    const exportDmBtn = document.getElementById('btn-export-data');
    const exportPlayerBtn = document.getElementById('btn-export-player');
    const hint = document.getElementById('admin-tools-hint');
    const navDm = document.getElementById('nav-dm-notes');
    const panelDm = document.getElementById('panel-dm');
    const isDm = canUseDestructiveAdmin();
    let isPlayerSeat = false;
    if (window.SeatSession && typeof SeatSession.get === 'function') {
        const seat = SeatSession.get();
        isPlayerSeat = !!(seat && seat.role === 'player');
    }

    if (importBtn) {
        importBtn.style.display = isDm ? '' : 'none';
        importBtn.disabled = !isDm;
        importBtn.title = isDm
            ? 'Replace live campaign data inside this game from JSON (DM)'
            : 'DM seat required to import campaign data';
    }
    if (resetBtn) {
        resetBtn.style.display = isDm ? '' : 'none';
        resetBtn.disabled = !isDm;
        resetBtn.title = isDm
            ? 'Permanently delete this game from the board (type DELETE)'
            : 'DM seat required to delete the game';
    }
    // DM: full export only (already has all player private data via seat)
    if (exportDmBtn) {
        exportDmBtn.style.display = isDm ? '' : 'none';
        exportDmBtn.disabled = !isDm;
        exportDmBtn.title = 'DM only: full package with PIN material, DM notes, and all player private fields';
    }
    // Players: review copy only (own secrets; no DM notes / PIN hashes)
    if (exportPlayerBtn) {
        exportPlayerBtn.style.display = isPlayerSeat ? '' : 'none';
        exportPlayerBtn.disabled = !isPlayerSeat;
        exportPlayerBtn.title = isPlayerSeat
            ? 'Export only your character sheet + shared map/game data (no other players)'
            : 'Available when seated as a player character';
    }
    // Ethan #2: DM Notes nav/panel only for DM seat (server also 403s player sessions)
    if (navDm) navDm.style.display = isDm ? '' : 'none';
    if (panelDm && !isDm) {
        panelDm.classList.remove('active');
        panelDm.style.display = 'none';
        // If player was somehow on DM panel, bounce to map
        if (panelDm.classList.contains('active')) {
            /* handled by remove + hide */
        }
        const activeNav = document.querySelector('.nav-item.active');
        if (activeNav && activeNav.getAttribute('data-target') === 'panel-dm') {
            const mapNav = document.querySelector('.nav-item[data-target="panel-map"]');
            if (mapNav) mapNav.click();
        }
    } else if (panelDm && isDm) {
        panelDm.style.display = '';
    }
    if (hint) {
        if (isPlayerSeat && !isDm) {
            hint.style.display = 'block';
            hint.textContent = 'Player seat: Export My Character only. Import / Delete Game / Add·Delete Campaign / DM Notes / full Export / map upload / combat turn controls / location-note delete are DM tools.';
        } else {
            hint.style.display = 'none';
            hint.textContent = '';
        }
    }
    updateMapUploadChrome();
    updateCombatAndSessionChrome();
    updateEmptyCampaignChrome();
    refreshExportStaleBanner();
}

async function refreshExportStaleBanner() {
    const el = document.getElementById('export-stale-banner');
    if (!el || !IS_SERVER_MODE) return;
    // DM-only reminder (players don't use full package export)
    if (!canUseDestructiveAdmin()) {
        el.style.display = 'none';
        el.textContent = '';
        return;
    }
    try {
        const res = await fetch('/api/export-status', {
            cache: 'no-store',
            headers: sessionHeaders()
        });
        if (!res.ok) {
            el.style.display = 'none';
            return;
        }
        const data = await res.json();
        if (data.stale) {
            el.style.display = 'block';
            if (!data.lastExportedAt) {
                el.textContent = 'No full game export yet. Export Game (DM) so table + DM PINs are backed up.';
            } else {
                const mins = Math.floor((data.ageMs || 0) / 60000);
                const ago = mins >= 60
                    ? (Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm ago')
                    : (mins + ' min ago');
                el.textContent = 'Last DM game export was ' + ago + '. Export again if you made important changes.';
            }
        } else {
            el.style.display = 'none';
            el.textContent = '';
        }
    } catch (e) {
        el.style.display = 'none';
    }
}

function normalizeImportPayload(parsed) {
    if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'File is not a JSON object.' };
    }
    // Compatibility: very old single-campaign shape
    if (parsed.characters && !parsed.campaigns) {
        const oldCampaign = {
            id: 'phandelver',
            name: 'Imported Campaign',
            mapImage: 'phandelver-map-exterior-player.webp',
            characters: parsed.characters,
            sessionLogs: parsed.sessionLogs || [],
            mapMarkers: parsed.mapMarkers || [],
            partyPosition: parsed.partyPosition || { x: 350, y: 480, lastUpdated: 'Imported state' }
        };
        parsed = {
            campaigns: [oldCampaign],
            activeCampaignId: 'phandelver',
            combatants: parsed.combatants || [],
            activeCombatantIndex: parsed.activeCombatantIndex || 0,
            combatRound: parsed.combatRound || 1,
            rollHistory: parsed.rollHistory || []
        };
    }
    if (!Array.isArray(parsed.campaigns) || parsed.campaigns.length === 0) {
        return { ok: false, error: 'Invalid structure: need a non-empty campaigns array.' };
    }
    for (let i = 0; i < parsed.campaigns.length; i++) {
        const c = parsed.campaigns[i];
        if (!c || !c.id || !c.name) {
            return { ok: false, error: 'Campaign #' + (i + 1) + ' is missing id or name.' };
        }
        if (!c.characters || typeof c.characters !== 'object') {
            return { ok: false, error: 'Campaign "' + c.name + '" is missing characters.' };
        }
    }
    const payload = {
        campaigns: parsed.campaigns,
        activeCampaignId: parsed.activeCampaignId || parsed.campaigns[0].id,
        combatants: Array.isArray(parsed.combatants) ? parsed.combatants : [],
        activeCombatantIndex: typeof parsed.activeCombatantIndex === 'number' ? parsed.activeCombatantIndex : 0,
        combatRound: typeof parsed.combatRound === 'number' ? parsed.combatRound : 1,
        rollHistory: Array.isArray(parsed.rollHistory) ? parsed.rollHistory : []
    };
    if (!payload.campaigns.find(c => c.id === payload.activeCampaignId)) {
        payload.activeCampaignId = payload.campaigns[0].id;
    }
    return { ok: true, payload };
}

function summarizeImportPayload(payload, meta) {
    const camps = payload.campaigns || [];
    let charTotal = 0;
    const campLines = camps.map(c => {
        const n = Object.keys(c.characters || {}).length;
        charTotal += n;
        const logs = (c.sessionLogs || []).length;
        const markers = (c.mapMarkers || []).length;
        return '<li><strong>' + escapeHtml(c.name) + '</strong> <span class="text-muted">(' +
            escapeHtml(c.id) + ')</span> — ' + n + ' characters, ' + logs + ' logs, ' + markers + ' markers</li>';
    }).join('');
    const bytes = meta && meta.byteLength != null ? meta.byteLength : null;
    const fileLabel = meta && meta.fileName ? escapeHtml(meta.fileName) : '—';
    const sizeLabel = bytes != null
        ? (bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB')
        : '—';
    return (
        '<dl>' +
        '<dt>File</dt><dd>' + fileLabel + '</dd>' +
        '<dt>Size</dt><dd>' + sizeLabel + '</dd>' +
        '<dt>Campaigns</dt><dd>' + camps.length + '</dd>' +
        '<dt>Characters</dt><dd>' + charTotal + ' total</dd>' +
        '<dt>Active id</dt><dd><code>' + escapeHtml(payload.activeCampaignId) + '</code></dd>' +
        '<dt>Combatants</dt><dd>' + (payload.combatants || []).length + '</dd>' +
        '<dt>Roll history</dt><dd>' + (payload.rollHistory || []).length + ' entries</dd>' +
        '<dt>Combat round</dt><dd>' + payload.combatRound + '</dd>' +
        '</dl>' +
        '<p style="margin:10px 0 4px;font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;font-weight:600;">Campaigns in file</p>' +
        '<ul>' + campLines + '</ul>'
    );
}

let _pendingImportPayload = null;

function downloadJsonBlob(obj, filename) {
    const dataStr = JSON.stringify(obj, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const linkElement = document.createElement('a');
    linkElement.href = url;
    linkElement.download = filename;
    document.body.appendChild(linkElement);
    linkElement.click();
    linkElement.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return blob.size;
}

async function applyFullStateReplace(payload, logLabel) {
    state.campaigns = payload.campaigns;
    state.activeCampaignId = payload.activeCampaignId;
    state.combatants = payload.combatants || [];
    state.activeCombatantIndex = payload.activeCombatantIndex || 0;
    state.combatRound = payload.combatRound || 1;
    state.rollHistory = payload.rollHistory || [];
    state.revisions = {};
    state.locks = {};
    state.dmEditLocks = {};
    state.offers = [];
    state.claims = {};

    const camp = getActiveCampaign();
    if (camp && camp.characters) {
        const keys = Object.keys(camp.characters);
        if (!keys.includes(state.activeCharacterId)) {
            state.activeCharacterId = keys[0] || null;
        }
    }

    saveLocalUi();
    try {
        localStorage.setItem('dnd_campaign_state', JSON.stringify(buildSharedExportPayload()));
    } catch (e) {
        console.error(e);
    }

    let ok = true;
    if (IS_SERVER_MODE) {
        ok = await saveStateToServer();
    }
    renderCampaignSelector();
    renderAll();
    updateCharSheetChrome();
    updateAdminToolsChrome();
    if (ok) {
        setSyncStatus(logLabel || 'Replaced', 'ok');
        if (typeof logRoll === 'function') {
            logRoll('System', logLabel || 'Data replace', '-', logLabel || 'State replaced');
        }
    }
    return ok;
}

function initImportExport() {
    updateAdminToolsChrome();

    // Player-safe review export (any seat)
    const exportPlayerBtn = document.getElementById('btn-export-player');
    if (exportPlayerBtn) {
        exportPlayerBtn.addEventListener('click', async () => {
            try {
                setSyncStatus('Exporting…', 'warn');
                let payload;
                if (IS_SERVER_MODE) {
                    const res = await fetch('/api/export-player', {
                        cache: 'no-store',
                        headers: sessionHeaders()
                    });
                    if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        throw new Error(err.error || ('Export failed (' + res.status + ')'));
                    }
                    payload = await res.json();
                } else {
                    payload = buildSharedExportPayload();
                    payload.schemaHint = 'beer-club-dnd-player-export-v1';
                    payload.exportKind = 'player_review';
                    payload.tablePin = '';
                    payload.dmPin = '';
                }
                const safeName = String(payload.gameName || 'campaign')
                    .replace(/[^a-zA-Z0-9._-]+/g, '_')
                    .slice(0, 40);
                const who = payload.viewerCharacterId
                    ? ('_' + String(payload.viewerCharacterId).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 24))
                    : '';
                const name = `dnd_my_character_${safeName}${who}_${new Date().toISOString().split('T')[0]}.json`;
                const size = downloadJsonBlob(payload, name);
                setSyncStatus('Exported ' + (size < 1024 ? size + ' B' : (size / 1024).toFixed(1) + ' KB'), 'ok');
                if (typeof logRoll === 'function') {
                    logRoll('System', 'Player Export', '-', 'My character export (no other players, no DM notes/PINs).');
                }
            } catch (e) {
                console.error(e);
                setSyncStatus('Export failed', 'err');
                alert('Export failed: ' + (e.message || e));
            }
        });
    }

    // Full DM package
    document.getElementById('btn-export-data').addEventListener('click', async () => {
        try {
            if (!canUseDestructiveAdmin()) {
                alert('Full game export requires a DM seat. Use Export Player Copy for a review file.');
                return;
            }
            setSyncStatus('Exporting…', 'warn');
            let payload;
            if (IS_SERVER_MODE) {
                const res = await fetch('/api/export-package', {
                    cache: 'no-store',
                    headers: sessionHeaders()
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || ('Export failed (' + res.status + ')'));
                }
                payload = await res.json();
            } else {
                payload = buildSharedExportPayload();
                payload.schemaHint = 'beer-club-dnd-game-v2';
                payload.exportKind = 'dm_full';
            }
            const safeName = String(payload.gameName || 'campaign')
                .replace(/[^a-zA-Z0-9._-]+/g, '_')
                .slice(0, 40);
            const name = `dnd_game_export_${safeName}_${new Date().toISOString().split('T')[0]}.json`;
            const size = downloadJsonBlob(payload, name);
            setSyncStatus('Exported ' + (size < 1024 ? size + ' B' : (size / 1024).toFixed(1) + ' KB'), 'ok');
            if (typeof logRoll === 'function') {
                logRoll('System', 'Data Export', '-', 'Full DM game package exported.');
            }
            refreshExportStaleBanner();
        } catch (e) {
            console.error(e);
            setSyncStatus('Export failed', 'err');
            alert('Export failed: ' + (e.message || e));
        }
    });

    const fileInput = document.getElementById('file-import');
    const importModal = document.getElementById('modal-import-preview');
    const importSummary = document.getElementById('import-preview-summary');
    const importConfirm = document.getElementById('import-confirm-input');
    const importApply = document.getElementById('btn-import-apply');

    document.getElementById('btn-import-trigger').addEventListener('click', () => {
        if (!canUseDestructiveAdmin()) {
            alert('Import requires a DM seat.');
            return;
        }
        fileInput.value = '';
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!canUseDestructiveAdmin()) {
            alert('Import requires a DM seat.');
            fileInput.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const text = String(evt.target.result || '');
                const parsed = JSON.parse(text);
                const norm = normalizeImportPayload(parsed);
                _pendingImportPayload = null;
                if (!norm.ok) {
                    importSummary.innerHTML = '<p class="preview-error">' + escapeHtml(norm.error) + '</p>';
                    importApply.disabled = true;
                    if (importConfirm) importConfirm.value = '';
                    if (importModal) importModal.style.display = 'flex';
                    return;
                }
                _pendingImportPayload = norm.payload;
                importSummary.innerHTML = summarizeImportPayload(norm.payload, {
                    fileName: file.name,
                    byteLength: text.length
                });
                if (importConfirm) {
                    importConfirm.value = '';
                    importApply.disabled = true;
                }
                if (importModal) importModal.style.display = 'flex';
                if (importConfirm) setTimeout(() => importConfirm.focus(), 50);
            } catch (err) {
                console.error(err);
                importSummary.innerHTML = '<p class="preview-error">Could not parse JSON: ' +
                    escapeHtml(err.message || String(err)) + '</p>';
                importApply.disabled = true;
                _pendingImportPayload = null;
                if (importModal) importModal.style.display = 'flex';
            }
        };
        reader.onerror = () => {
            alert('Could not read file.');
            fileInput.value = '';
        };
        reader.readAsText(file);
    });

    if (importConfirm && importApply) {
        importConfirm.addEventListener('input', () => {
            const ok = importConfirm.value.trim().toUpperCase() === 'IMPORT' && !!_pendingImportPayload;
            importApply.disabled = !ok;
        });
        importApply.addEventListener('click', async () => {
            if (!canUseDestructiveAdmin()) {
                alert('Import requires a DM seat.');
                return;
            }
            if (!_pendingImportPayload || importConfirm.value.trim().toUpperCase() !== 'IMPORT') return;
            importApply.disabled = true;
            const payload = _pendingImportPayload;
            _pendingImportPayload = null;
            const ok = await applyFullStateReplace(payload, 'Data Import');
            if (importModal) importModal.style.display = 'none';
            fileInput.value = '';
            if (importConfirm) importConfirm.value = '';
            if (ok) {
                alert('Campaign database imported successfully.');
            } else {
                alert('Import applied locally but server save failed. Check sync status and try Export / retry.');
            }
        });
    }

    const resetModal = document.getElementById('modal-reset-confirm');
    const resetConfirm = document.getElementById('reset-confirm-input');
    const resetApply = document.getElementById('btn-reset-apply');

    document.getElementById('btn-reset-data').addEventListener('click', () => {
        if (!canUseDestructiveAdmin()) {
            alert('Delete Game requires a DM seat.');
            return;
        }
        if (resetConfirm) {
            resetConfirm.value = '';
            if (resetApply) resetApply.disabled = true;
        }
        if (resetModal) resetModal.style.display = 'flex';
        if (resetConfirm) setTimeout(() => resetConfirm.focus(), 50);
    });

    if (resetConfirm && resetApply) {
        resetConfirm.addEventListener('input', () => {
            resetApply.disabled = resetConfirm.value.trim().toUpperCase() !== 'DELETE';
        });
        resetApply.addEventListener('click', async () => {
            if (!canUseDestructiveAdmin()) {
                alert('Delete Game requires a DM seat.');
                return;
            }
            if (resetConfirm.value.trim().toUpperCase() !== 'DELETE') return;
            resetApply.disabled = true;
            try {
                const res = await fetch('/api/game/delete', {
                    method: 'POST',
                    headers: sessionHeaders(),
                    body: '{}'
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    alert(data.error || 'Could not delete game.');
                    resetApply.disabled = false;
                    return;
                }
                if (resetModal) resetModal.style.display = 'none';
                resetConfirm.value = '';
                // Leave table fully and return to board
                if (typeof window.leaveGameAndReturn === 'function') {
                    await window.leaveGameAndReturn();
                } else {
                    if (window.SeatSession) SeatSession.clear();
                    if (window.GameAccess) GameAccess.clear();
                    location.reload();
                }
            } catch (e) {
                console.error(e);
                alert('Network error deleting game.');
                resetApply.disabled = false;
            }
        });
    }

    // Refresh export age banner periodically while app is open
    if (IS_SERVER_MODE) {
        setInterval(() => { refreshExportStaleBanner(); }, 5 * 60 * 1000);
    }
}


// ----------------------------------------------------
// Master Renderer
// ----------------------------------------------------
function migrateAllCharacters() {
    (state.campaigns || []).forEach(camp => {
        Object.values(camp.characters || {}).forEach(ensureProficiencyFlags);
    });
}

function renderAll() {
    migrateAllCharacters();
    updateEmptyCampaignChrome();
    renderMapMarkers();
    renderCharacterTabs();
    renderSelectedCharacter();
    renderInitiativeList();
    renderRollHistory();
    renderSessionLogsList();
}
