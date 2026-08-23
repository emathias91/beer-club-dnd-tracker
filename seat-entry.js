/**
 * Entry seat selection + session helpers for middle-path multi-device.
 * Loaded after app.js so it can wrap boot; also used standalone hooks from HTML.
 */
(function () {
    const SESSION_KEY = 'dnd_seat_session';

    window.SeatSession = {
        get() {
            try {
                return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
            } catch (e) {
                return null;
            }
        },
        set(obj) {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(obj));
        },
        clear() {
            sessionStorage.removeItem(SESSION_KEY);
        },
        token() {
            const s = this.get();
            return s && s.sessionToken;
        },
        headers(extra) {
            const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
            const t = this.token();
            if (t) h['X-Session-Token'] = t;
            return h;
        },
        isDm() {
            const s = this.get();
            return s && s.role === 'dm';
        },
        characterId() {
            const s = this.get();
            return s && s.characterId;
        },
        campaignId() {
            const s = this.get();
            return s && s.campaignId;
        }
    };

    function $(id) {
        return document.getElementById(id);
    }

    function showEntry() {
        const entry = $('entry-screen');
        const app = document.querySelector('.app-container');
        if (entry) entry.style.display = 'flex';
        if (app) app.style.display = 'none';
    }

    function showApp() {
        const entry = $('entry-screen');
        const app = document.querySelector('.app-container');
        if (entry) entry.style.display = 'none';
        if (app) app.style.display = 'flex';
    }

    async function loadEntry() {
        const status = $('entry-status');
        try {
            const res = await fetch('/api/entry', { cache: 'no-store' });
            const data = await res.json();
            $('entry-campaign-name').textContent = data.campaignName || 'Campaign';
            const img = $('entry-map-image');
            if (img && data.mapImage) {
                img.src = data.mapImage;
                img.alt = data.campaignName || 'Map';
            }
            const list = $('entry-character-list');
            list.innerHTML = '';
            if (!data.ready || !data.characters || !data.characters.length) {
                list.innerHTML = '<p class="entry-hint">' +
                    (data.message || 'No characters yet. Enter as DM to initialize the table, or wait for the host to seed the campaign.') +
                    '</p>';
            } else {
                data.characters.forEach(ch => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'entry-seat-btn' + (ch.claimed ? ' claimed' : '');
                    btn.innerHTML =
                        '<span class="entry-seat-name">' + escapeHtml(ch.name) + '</span>' +
                        '<span class="entry-seat-meta">' +
                        escapeHtml([ch.player, ch.class, ch.level != null && ch.level !== '' ? 'Lvl ' + ch.level : '']
                            .filter(Boolean).join(' · ')) +
                        '</span>' +
                        (ch.claimed
                            ? '<span class="entry-seat-badge">In use' +
                              (ch.claimLabel ? ': ' + escapeHtml(ch.claimLabel) : '') + '</span>'
                            : '') +
                        (ch.dmLocked ? '<span class="entry-seat-badge dm">DM lock</span>' : '');
                    btn.addEventListener('click', () => claimCharacter(data.campaignId, ch, ch.claimed));
                    list.appendChild(btn);
                });
            }
            if (status) status.textContent = '';
            window.__entryCampaignId = data.campaignId;
        } catch (e) {
            if (status) status.textContent = 'Could not reach server.';
            console.error(e);
        }
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function claimCharacter(campaignId, ch, alreadyClaimed) {
        let steal = false;
        if (alreadyClaimed) {
            steal = confirm(
                (ch.name || 'Character') +
                ' is marked in use' +
                (ch.claimLabel ? ' by ' + ch.claimLabel : '') +
                '.\n\nTake over this seat? The other device will lose the claim.'
            );
            if (!steal) return;
        }
        const label = prompt('Label for this device (optional):', ch.player || ch.name || '') || ch.name;
        try {
            const res = await fetch('/api/seats/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    campaignId,
                    characterId: ch.id,
                    label,
                    steal
                })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'Could not claim seat');
                loadEntry();
                return;
            }
            SeatSession.set({
                sessionToken: data.sessionToken,
                role: data.role,
                characterId: data.characterId,
                campaignId: data.campaignId,
                label: data.label
            });
            await enterApp();
        } catch (e) {
            alert('Network error claiming seat');
            console.error(e);
        }
    }

    async function claimDm() {
        const pinBox = $('entry-dm-pin');
        const pin = pinBox ? pinBox.value : '';
        const label = ($('entry-dm-label') && $('entry-dm-label').value) || 'DM';
        try {
            const res = await fetch('/api/seats/dm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin, label })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'DM login failed');
                return;
            }
            SeatSession.set({
                sessionToken: data.sessionToken,
                role: 'dm',
                characterId: null,
                campaignId: data.campaignId,
                label: data.label
            });
            await enterApp();
        } catch (e) {
            alert('Network error');
            console.error(e);
        }
    }

    async function enterApp() {
        showApp();
        if (typeof window.bootCampaignApp === 'function') {
            await window.bootCampaignApp();
        }
        startHeartbeat();
    }

    let heartbeatTimer = null;
    function startHeartbeat() {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(async () => {
            const t = SeatSession.token();
            if (!t) return;
            try {
                await fetch('/api/seats/heartbeat', {
                    method: 'POST',
                    headers: SeatSession.headers(),
                    body: JSON.stringify({})
                });
            } catch (e) { /* ignore */ }
        }, 30000);
    }

    async function leaveSeat() {
        const t = SeatSession.token();
        if (t) {
            try {
                await fetch('/api/seats/release', {
                    method: 'POST',
                    headers: SeatSession.headers(),
                    body: JSON.stringify({})
                });
            } catch (e) { /* ignore */ }
        }
        SeatSession.clear();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        showEntry();
        loadEntry();
    }

    window.leaveSeatAndReturn = leaveSeat;

    document.addEventListener('DOMContentLoaded', async () => {
        // Wire entry controls
        const dmBtn = $('entry-dm-submit');
        if (dmBtn) dmBtn.addEventListener('click', claimDm);
        const refreshBtn = $('entry-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', loadEntry);

        const existing = SeatSession.get();
        if (existing && existing.sessionToken) {
            // Validate heartbeat
            try {
                const res = await fetch('/api/seats/heartbeat', {
                    method: 'POST',
                    headers: SeatSession.headers(),
                    body: JSON.stringify({})
                });
                if (res.ok) {
                    await enterApp();
                    return;
                }
            } catch (e) { /* fall through */ }
            SeatSession.clear();
        }

        showEntry();
        loadEntry();
        // Poll entry list so claim badges update
        setInterval(loadEntry, 8000);
    });
})();
