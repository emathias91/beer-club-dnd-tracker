// Combat tracker (initiative, turns), dice roller, and party-on-tracker helpers.

import { state, getActiveCampaign, saveLocalUi } from './state.js';
import { canUseDestructiveAdmin, requireDmAction } from './auth.js';
import {
    sessionHeaders, setSyncStatus, saveStateToServer, loadState, logRoll,
    IS_SERVER_MODE, markCombatSyncSuppressedUntil
} from './sync.js';
import { escapeHtml, formatCombatHpDisplay, playDiceSound } from './utils.js';
import { updateSessionLogChrome } from './sessionLogs.js';

export function initDefaultCombatants(chars) {
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
export function partyCharactersForCombat() {
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

export function combatantMatchesParty(cb, charId, name) {
    if (!cb || cb.isMonster) return false;
    if (charId && cb.characterId && String(cb.characterId) === String(charId)) return true;
    const n = String(name || '').trim().toLowerCase();
    const cn = String(cb.name || '').trim().toLowerCase();
    return !!(n && cn && n === cn);
}

export function isPartyMemberInCombat(charId, name) {
    return (state.combatants || []).some(cb => combatantMatchesParty(cb, charId, name));
}

/** Parse optional number fields; blank / ?? → null. */
export function parseOptionalCombatNumber(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s || s === '??' || s === '?' || s.toLowerCase() === 'unknown') return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
}

export function combatInitSortValue(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

export function buildCombatantFromParty(p, opts) {
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
export function ensureAllPartyOnTracker(opts) {
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

export function renderPartyQuickAddList() {
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

export function openAddCombatantModal() {
    if (!requireDmAction('add combatants')) return;
    document.getElementById('init-name-input').value = '';
    document.getElementById('init-score-input').value = '';
    document.getElementById('init-hp-input').value = '';
    document.getElementById('init-is-monster').checked = false;
    renderPartyQuickAddList();
    document.getElementById('modal-add-combatant').style.display = 'flex';
}

export function rollForCharacter(charName, checkName, modStr) {
    const d20 = rollDie(20);
    const mod = parseInt(modStr) || 0;
    const total = d20 + mod;

    let critique = '';
    if (d20 === 20) critique = ' (CRITICAL SUCCESS!)';
    if (d20 === 1) critique = ' (CRITICAL FAILURE!)';

    logRoll(charName, checkName, total, `Rolled d20: Natural ${d20} + ${mod} modifier${critique}`, d20);
    switchToCombatPanel();
}

export function switchToCombatPanel() {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));

    const navCombat = document.querySelector('.nav-item[data-target="panel-combat"]');
    if (navCombat) navCombat.classList.add('active');

    const panelCombat = document.getElementById('panel-combat');
    if (panelCombat) panelCombat.classList.add('active');

    renderInitiativeList();
    renderRollHistory();
}

export function initCombatPanel() {
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

    // Save Combatant (Initiative) — moved out of the old initModals grab-bag.
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
}

/** Don't let poll stomp combat for a few seconds after a local combat edit. */
export function markCombatLocalEdit(ms) {
    markCombatSyncSuppressedUntil(ms);
}

/**
 * Persist combat tracker immediately (not only via debounced full smartSave).
 * Prevents Round 1 flash → poll restore Round 2.
 */
export async function saveCombatNow() {
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

export function sortCombatantsByInitiative() {
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

export function moveCombatant(idx, dir) {
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

export function getDiceRollerName() {
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

export function rollDie(sides) {
    return Math.floor(Math.random() * sides) + 1;
}

/** d2 / coin: 1 = Yes, 2 = No (True/False style). */
export function formatDieFace(sides, n) {
    if (sides === 2) return n === 1 ? 'Yes' : 'No';
    return String(n);
}

export function getDiceCount() {
    const el = document.getElementById('dice-count-val');
    let n = el ? parseInt(el.value, 10) : 1;
    if (!Number.isFinite(n) || n < 1) n = 1;
    if (n > 99) n = 99;
    return n;
}

export function resetDiceCountToOne() {
    const el = document.getElementById('dice-count-val');
    if (el) el.value = '1';
}

export function renderDiceFaces(faces, opts) {
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

export function rollDice(sides) {
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

export function renderRollHistory() {
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

export function renderInitiativeList() {
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

export function nextCombatTurn() {
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

export function resetCombatTracker() {
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

export function sortInitiativeList() {
    state.combatants.sort((a, b) => combatInitSortValue(b.initiative) - combatInitSortValue(a.initiative));
}

/** Combat turn controls + session log DM tools + player Add to Log. */
export function updateCombatAndSessionChrome() {
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
