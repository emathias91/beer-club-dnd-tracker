// DM notes: server-side, PIN-gated private notes. Self-contained subsystem —
// physically lived inside app.js's "Character Sheet" section comment before
// this split, despite being unrelated to character sheets.

import { sessionHeaders } from './sync.js';

const dmState = { pin: null, dirty: false, saveTimer: null };

export function dmShow(which) {
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

export async function dmApi(action, payload) {
    const res = await fetch(`/api/dm-notes/${action}`, {
        method: 'POST',
        headers: sessionHeaders(),
        body: JSON.stringify(payload || {})
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { ok: res.ok, status: res.status, data };
}

export async function refreshDmGate() {
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

export function dmSetStatus(msg, isError) {
    const el = document.getElementById('dm-status');
    if (!el) return;
    el.innerText = msg;
    el.className = 'dm-status' + (isError ? ' dm-status-error' : '');
}

export function initDmPanel() {
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
