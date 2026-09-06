// Rolling backups & restore UI (P2 #10 / F9) — DM-only. Campaign data
// (manifest + meta/map/combat/characters, gzipped) and DM Notes (encrypted
// with the DM PIN) are backed up separately and listed in the same modal.

import { canUseDestructiveAdmin } from './auth.js';
import { sessionHeaders } from './sync.js';
import { escapeHtml } from './utils.js';

let _pendingRestore = null; // { fileName }

function fmtBytes(n) {
    if (!Number.isFinite(n)) return '?';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function fmtTime(iso) {
    if (!iso) return 'Unknown time';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function showStatus(msg) {
    const el = document.getElementById('backups-status');
    if (!el) return;
    if (!msg) {
        el.style.display = 'none';
        el.textContent = '';
        return;
    }
    el.style.display = 'block';
    el.textContent = msg;
}

export function updateBackupsChrome() {
    const btn = document.getElementById('btn-backups-open');
    if (!btn) return;
    const isDm = canUseDestructiveAdmin();
    btn.style.display = isDm ? '' : 'none';
    btn.disabled = !isDm;
}

async function fetchJson(url, opts) {
    const res = await fetch(url, Object.assign({ headers: sessionHeaders() }, opts || {}));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
}

function renderCampaignBackups(backups) {
    const list = document.getElementById('backups-list');
    if (!list) return;
    list.innerHTML = backups.map(b => `
        <div class="backup-row">
            <div class="backup-row-info">
                <div class="backup-row-time">${escapeHtml(fmtTime(b.createdAt))}</div>
                <div class="backup-row-meta">${b.campaignCount} campaign(s) &middot; ${b.characterCount} character(s) &middot; ${fmtBytes(b.size)}${b.reason ? ' &middot; ' + escapeHtml(b.reason) : ''}</div>
            </div>
            <button type="button" class="btn-dnd btn-restore-campaign" data-filename="${escapeHtml(b.fileName)}" data-time="${escapeHtml(fmtTime(b.createdAt))}">
                <i class="fa-solid fa-clock-rotate-left"></i> Restore
            </button>
        </div>
    `).join('');

    list.querySelectorAll('.btn-restore-campaign').forEach(btn => {
        btn.addEventListener('click', () => {
            openRestoreConfirm(
                btn.getAttribute('data-filename'),
                'Restore campaign data from ' + btn.getAttribute('data-time') + '? This replaces live data on the server for everyone at the table.'
            );
        });
    });
}

function renderDmNotesBackups(backups) {
    const list = document.getElementById('dm-notes-backups-list');
    if (!list) return;
    list.innerHTML = backups.map(b => `
        <div class="backup-row">
            <div class="backup-row-info">
                <div class="backup-row-time">${escapeHtml(fmtTime(b.createdAt))}</div>
                <div class="backup-row-meta">${fmtBytes(b.size)}</div>
            </div>
            <input type="password" class="dm-notes-restore-pin" placeholder="DM PIN" autocomplete="off">
            <button type="button" class="btn-dnd btn-restore-dmnotes" data-filename="${escapeHtml(b.fileName)}">Restore</button>
        </div>
    `).join('');

    list.querySelectorAll('.btn-restore-dmnotes').forEach(btn => {
        btn.addEventListener('click', async () => {
            const row = btn.closest('.backup-row');
            const pinInput = row ? row.querySelector('.dm-notes-restore-pin') : null;
            const pin = pinInput ? pinInput.value : '';
            if (!pin) {
                alert('Enter the DM PIN that was active when this backup was taken.');
                return;
            }
            btn.disabled = true;
            try {
                await fetchJson('/api/dm-notes/backups/restore', {
                    method: 'POST',
                    body: JSON.stringify({ filename: btn.getAttribute('data-filename'), pin })
                });
                if (pinInput) pinInput.value = '';
                showStatus('DM notes restored.');
            } catch (e) {
                alert(e.message || 'Restore failed.');
            } finally {
                btn.disabled = false;
            }
        });
    });
}

function openRestoreConfirm(fileName, label) {
    _pendingRestore = { fileName };
    const panel = document.getElementById('backups-restore-confirm');
    const labelEl = document.getElementById('backups-restore-confirm-label');
    const input = document.getElementById('backups-restore-confirm-input');
    const applyBtn = document.getElementById('btn-backups-restore-apply');
    if (labelEl) labelEl.textContent = label;
    if (input) input.value = '';
    if (applyBtn) applyBtn.disabled = true;
    if (panel) panel.style.display = 'block';
}

function closeRestoreConfirm() {
    _pendingRestore = null;
    const panel = document.getElementById('backups-restore-confirm');
    if (panel) panel.style.display = 'none';
}

async function refreshBackupsModal() {
    showStatus('Loading…');
    try {
        const [campaignData, dmNotesData] = await Promise.all([
            fetchJson('/api/backups'),
            fetchJson('/api/dm-notes/backups')
        ]);
        renderCampaignBackups(campaignData.backups || []);
        renderDmNotesBackups(dmNotesData.backups || []);
        showStatus('');
    } catch (e) {
        showStatus(e.message || 'Could not load backups.');
    }
}

export function initBackupsPanel() {
    const openBtn = document.getElementById('btn-backups-open');
    const modal = document.getElementById('modal-backups');
    if (openBtn && modal) {
        openBtn.addEventListener('click', () => {
            if (!canUseDestructiveAdmin()) {
                alert('Backups require a DM seat.');
                return;
            }
            closeRestoreConfirm();
            modal.style.display = 'flex';
            refreshBackupsModal();
        });
    }

    const createBtn = document.getElementById('btn-backups-create');
    if (createBtn) {
        createBtn.addEventListener('click', async () => {
            createBtn.disabled = true;
            showStatus('Creating backup…');
            try {
                await fetchJson('/api/backups/create', { method: 'POST' });
                showStatus('Backup created.');
                await refreshBackupsModal();
            } catch (e) {
                showStatus(e.message || 'Backup failed.');
            } finally {
                createBtn.disabled = false;
            }
        });
    }

    const confirmInput = document.getElementById('backups-restore-confirm-input');
    const applyBtn = document.getElementById('btn-backups-restore-apply');
    if (confirmInput && applyBtn) {
        confirmInput.addEventListener('input', () => {
            applyBtn.disabled = confirmInput.value.trim().toUpperCase() !== 'RESTORE';
        });
        applyBtn.addEventListener('click', async () => {
            if (!_pendingRestore) return;
            applyBtn.disabled = true;
            showStatus('Restoring…');
            try {
                await fetchJson('/api/backups/restore', {
                    method: 'POST',
                    body: JSON.stringify({ filename: _pendingRestore.fileName })
                });
                closeRestoreConfirm();
                showStatus('Restored. Reloading…');
                setTimeout(() => location.reload(), 1200);
            } catch (e) {
                showStatus(e.message || 'Restore failed.');
                applyBtn.disabled = false;
            }
        });
    }

    const cancelBtn = document.getElementById('btn-backups-restore-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeRestoreConfirm);

    updateBackupsChrome();
}
