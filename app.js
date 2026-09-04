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
import { updateAdminToolsChrome, initImportExport } from './js/importExport.js';
// app.js is now an ES module — seat-entry.js reads this off window explicitly.
window.setSyncStatus = setSyncStatus;

// Exported for js/sync.js's circular import — see the note at the top of that
// file. These move to their own modules in later phases of the split.
export { renderAll };

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
// Modals: generic backdrop-close wiring (domain Save handlers now live with
// their owning subsystem module — see js/map.js, js/combat.js, js/campaigns.js,
// js/characters.js, js/sessionLogs.js)
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
