// Character sheet: core render/edit, equipment, skills, resources/rests, coins,
// DM lock chrome, and the char-specs/HP modal wiring (pulled out of app.js's
// old initModals grab-bag, folded into initCharacterPanel).
import { renderAll } from '../app.js';
import { INITIAL_CHARACTER_DATA } from '../data.js';
import { state, getActiveCampaign, getActiveCharacter, saveLocalUi } from './state.js';
import {
    sessionHeaders, setSyncStatus, saveState, saveStateToServer, IS_SERVER_MODE, loadState, logRoll
} from './sync.js';
import {
    escapeHtml, signed, updateCharacterHpColor, fitTextareaInScrollHost, bindTextareaScrollHosts
} from './utils.js';
import { rollForCharacter, switchToCombatPanel, rollDie } from './combat.js';

export function updateCharSheetChrome() {
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

export async function dmToggleCharLock(lock) {
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

export function renderCharacterTabs() {
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

export function parseEquipmentLine(line) {
    let s = String(line || '').replace(/^[\s\-\*•]+/, '').trim();
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

export function formatEquipmentLine(item) {
    const q = item.qty > 1 ? (item.qty + 'x ') : '';
    return q + item.name;
}

export function parseEquipmentList(equipmentText) {
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

export function serializeEquipmentList(items) {
    return (items || [])
        .filter(it => it && it.name && it.qty > 0)
        .map(formatEquipmentLine)
        .join('\n');
}

export function commitActiveEquipment(items) {
    const c = getActiveCharacter();
    if (!c) return;
    c.equipment = serializeEquipmentList(items);
    renderEquipmentGrid(c.equipment);
    saveState();
}

export function canEditPlayerPrivate(charId) {
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

export function setBackstoryTab(tab) {
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

export function renderPlayerPrivateNotes(c) {
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

export function initPlayerNotesUi() {
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
            if (IS_SERVER_MODE) {
                await saveStateToServer();
            }
            if (status) status.textContent = 'Saved.';
        });
    }
}

export function renderBackstoryAndTraits(c) {
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

export function renderEquipmentGrid(equipmentText) {
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

export function addEquipmentFromForm() {
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

export function removeEquipmentItem(itemKey) {
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

export function transferEquipmentItem(itemKey) {
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

export function initEquipmentInventory() {
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

export function skillKeyFromName(name) {
    const base = String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase())
        .replace(/[^a-zA-Z0-9]/g, '');
    return base || ('custom' + Date.now());
}

export function normalizeSkillModifier(raw) {
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

export function getCharacterSkillEntries(c) {
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

export function renderCharacterSkills(c, searchQuery) {
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

export function addCustomSkillFromForm() {
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

export function initSkillsPanel() {
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

export function renderSelectedCharacter() {
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

export function renderCharacterResources(c) {
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
        minus.innerText = '−';
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
        del.innerText = '×';
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

export function applyRest(c, kind) {
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

export function renderCoins(c) {
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

export function initRestButtons() {
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

/**
 * One-time migration: older saves stored only the final skill/save totals with
 * no record of WHICH proficiencies produced them. Infer them once from the
 * current numbers, write the flags down, and never guess again.
 */
export function ensureProficiencyFlags(c) {
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
export function recalculateCharacterModifiers(c) {
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

export function openEditCharSpecsModal() {
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
export function openHPModal(type) {
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

export function initCharacterPanel() {
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

    // Save Character Specs — moved out of the old initModals grab-bag.
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

    // Save HP Adjustments — moved out of the old initModals grab-bag.
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
}
