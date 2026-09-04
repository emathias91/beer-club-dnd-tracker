// D&D Campaign Dashboard Core Controller (Multi-Campaign Version)

import { INITIAL_CHARACTER_DATA } from './data.js';
import {
    escapeHtml, signed, formatCombatHpDisplay, hpHealthColor, updateCharacterHpColor,
    fitTextareaInScrollHost, bindTextareaScrollHosts, downloadJsonBlob, playDiceSound
} from './js/utils.js';
import { canUseDestructiveAdmin, requireDmAction } from './js/auth.js';
import { state, LOCAL_UI_KEY, loadLocalUi, saveLocalUi, getActiveCampaign, getActiveCharacter } from './js/state.js';
import {
    IS_SERVER_MODE, setSyncStatus, sessionHeaders, loadState, saveState, saveStateToServer,
    smartSaveToServer, processSeatNotices, startPollingSync, markCombatSyncSuppressedUntil, logRoll
} from './js/sync.js';
import { initDmPanel } from './js/dmNotes.js';
import { initSessionLogsPanel, renderSessionLogsList, updateSessionLogChrome } from './js/sessionLogs.js';
import { initMapPanel, renderMapMarkers, showMarkerDetails, updateMapUploadChrome } from './js/map.js';
import {
    initDefaultCombatants, rollForCharacter, switchToCombatPanel, initCombatPanel, rollDie,
    renderRollHistory, renderInitiativeList, updateCombatAndSessionChrome
} from './js/combat.js';
import {
    initCampaignSettings, updateEmptyCampaignChrome, renderCampaignSelector
} from './js/campaigns.js';
import {
    updateCharSheetChrome, dmToggleCharLock, initCharacterPanel, renderCharacterTabs,
    renderSelectedCharacter, initPlayerNotesUi, initEquipmentInventory,
    initSkillsPanel, initRestButtons, ensureProficiencyFlags
} from './js/characters.js';
// app.js is now an ES module — seat-entry.js reads this off window explicitly.
window.setSyncStatus = setSyncStatus;

// Exported for js/sync.js's circular import — see the note at the top of that
// file. These move to their own modules in later phases of the split.
export { renderAll, buildSharedExportPayload };

// ----------------------------------------------------
// Collaborative Sync & Core Initialization
// ----------------------------------------------------
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
