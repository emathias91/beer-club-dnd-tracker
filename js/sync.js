// Sync core: server snapshot load/save, debounced piece-save, poll loop, seat
// notices, and the shared activity log (logRoll).
//
// NOTE on the app.js import below: renderAll/buildSharedExportPayload still
// live in app.js as of this phase of the module split (they move to their own
// modules in later phases). This creates an intentional circular import with
// app.js, which itself imports from this module. That's safe here because
// every one of these names is only ever referenced inside a function body
// (never at module-eval time), so by the time any of them actually runs, both
// modules have finished loading. Update this import (and drop the
// circularity) as each function moves to its own module in a later phase.
import { renderAll, buildSharedExportPayload } from '../app.js';
// getDiceRollerName lives in js/combat.js (Combat phase) — same safe circular
// pattern: combat.js imports logRoll from this module, this module imports
// getDiceRollerName back from combat.js, only used inside function bodies.
import { getDiceRollerName } from './combat.js';
// renderCampaignSelector lives in js/campaigns.js (Campaigns phase) — same
// pattern again: campaigns.js imports saveState/etc. from this module, this
// module imports renderCampaignSelector back, only used inside function bodies.
import { renderCampaignSelector } from './campaigns.js';
// canEditPlayerPrivate lives in js/characters.js (Characters phase) — same
// pattern: characters.js imports saveState/etc. from this module, this module
// imports canEditPlayerPrivate back, only used inside function bodies.
import { canEditPlayerPrivate } from './characters.js';
import { state, getActiveCampaign, saveLocalUi } from './state.js';

export const IS_SERVER_MODE = window.location.protocol.startsWith('http');

export function setSyncStatus(text, level) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.textContent = text;
    el.dataset.level = level || 'ok';
}

export function sessionHeaders() {
    if (window.SeatSession) return SeatSession.headers();
    if (window.GameAccess) return GameAccess.headers();
    return { 'Content-Type': 'application/json' };
}

// Load state from server or localStorage fallback
export function applyServerSnapshot(fetchedState) {
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
export function checkSeatClaimStillMine() {
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

export async function loadState() {
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

export function loadStateFromLocalStorage() {
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

export function saveState() {
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
export function queueSmartSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => { smartSaveToServer(); }, 200);
}

export async function saveStateToServer() {
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

export async function smartSaveToServer() {
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

export function showOfferPendingToast(summary) {
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
export async function processSeatNotices() {
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

export function isModalOpen() {
    const overlays = document.querySelectorAll('.modal-overlay');
    for (let overlay of overlays) {
        if (window.getComputedStyle(overlay).display === 'flex' || overlay.style.display === 'flex') {
            return true;
        }
    }
    return false;
}

export function isUserEditing() {
    const active = document.activeElement;
    if (active) {
        const tagName = active.tagName.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || active.isContentEditable) {
            return true;
        }
    }
    return isModalOpen();
}

export function isSharedStateEqual(a, b) {
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

export function startPollingSync() {
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

export function resetToDefaults(opts) {
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

// Don't let poll stomp combat for a few seconds after a local combat edit.
// Setter (not a raw exported `let`) because combat code outside this module
// needs to write it, and an imported binding can't be reassigned from outside
// its owning module.
let _suppressCombatSyncUntil = 0;
export function markCombatSyncSuppressedUntil(ms) {
    _suppressCombatSyncUntil = Date.now() + (typeof ms === 'number' ? ms : 8000);
}

export function logRoll(roller, rollName, total, detail, rawDieResult = 10) {
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
