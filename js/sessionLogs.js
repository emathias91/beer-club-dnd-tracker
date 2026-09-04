// Session logs panel: DM-authored dated entries plus player "Add to Log".
//
// NOTE: getDiceRollerName is still defined in app.js as of this phase (moves in
// the Combat phase) and app.js already exports it for js/sync.js's circular
// import — reused here for the same reason. Safe: only referenced inside a
// function body, never at module-eval time.
import { getDiceRollerName } from '../app.js';
import { getActiveCampaign } from './state.js';
import { canUseDestructiveAdmin, requireDmAction } from './auth.js';
import { saveState } from './sync.js';
import { escapeHtml } from './utils.js';

/** Who is writing this note (seat character / DM label). */
export function getSessionActorName() {
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

export function formatSessionAdditionTime(iso) {
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

export function renderSessionLogBody(log) {
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

export function renderSessionLogsList() {
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

export function displaySessionDetail(log) {
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

export function openNewSessionLogModal() {
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

export function openEditSessionLogModal(log) {
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

export function openAddToSessionLogModal(log) {
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

/** Session logs: Write/Edit/Delete = DM; Add to Log = everyone (when a log is open). */
export function updateSessionLogChrome() {
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

export function initSessionLogsPanel() {
    document.getElementById('btn-new-log-modal').addEventListener('click', () => {
        openNewSessionLogModal();
    });

    // Save Session Log (DM write/edit only) — moved out of the old initModals grab-bag.
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

    // Player/DM append to an existing session log — moved out of the old initModals grab-bag.
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
