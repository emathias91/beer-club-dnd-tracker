// Campaign settings + CRUD (create/clone/delete), campaign selector, and the
// empty-table chrome. openDeleteCampaignModal/deleteCampaignById look nested
// inside initCampaignSettings from their indentation, but are actually already
// top-level functions (verified by brace-tracing the original code) — moved as
// plain top-level exports here, no restructuring needed.
import { renderAll } from '../app.js';
import { state, getActiveCampaign } from './state.js';
import { canUseDestructiveAdmin, requireDmAction } from './auth.js';
import { saveState, saveStateToServer, IS_SERVER_MODE, logRoll } from './sync.js';
import { initDefaultCombatants } from './combat.js';
import { showMarkerDetails } from './map.js';

export function initCampaignSettings() {
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
export async function createBlankCampaign(name) {
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

export function openCampaignSettingsModal() {
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
export function updateEmptyCampaignChrome() {
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

export function renderCampaignSelector() {
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
