/**
 * Beer Club Game Board + seat entry.
 * Flow: Board (pick game + table PIN) → Seat select → Main app.
 */
(function () {
    const SESSION_KEY = 'dnd_seat_session';
    const GAME_KEY = 'dnd_game_access';

    window.GameAccess = {
        get() {
            try {
                return JSON.parse(sessionStorage.getItem(GAME_KEY) || 'null');
            } catch (e) {
                return null;
            }
        },
        set(obj) {
            sessionStorage.setItem(GAME_KEY, JSON.stringify(obj));
        },
        clear() {
            sessionStorage.removeItem(GAME_KEY);
        },
        token() {
            const g = this.get();
            return g && g.gameAccessToken;
        },
        gameId() {
            const g = this.get();
            return g && g.gameId;
        },
        headers(extra) {
            const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
            const t = this.token();
            if (t) h['X-Game-Token'] = t;
            return h;
        }
    };

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
            const h = GameAccess.headers(extra);
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

    function showBoard() {
        const board = $('board-screen');
        const entry = $('entry-screen');
        const app = document.querySelector('.app-container');
        if (board) board.style.display = 'flex';
        if (entry) entry.style.display = 'none';
        if (app) app.style.display = 'none';
    }

    function showEntry() {
        const board = $('board-screen');
        const entry = $('entry-screen');
        const app = document.querySelector('.app-container');
        if (board) board.style.display = 'none';
        if (entry) entry.style.display = 'flex';
        if (app) app.style.display = 'none';
    }

    function showApp() {
        const board = $('board-screen');
        const entry = $('entry-screen');
        const app = document.querySelector('.app-container');
        if (board) board.style.display = 'none';
        if (entry) entry.style.display = 'none';
        if (app) app.style.display = 'flex';
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    let boardGames = [];
    let selectedGame = null;
    let setupMode = false;

    async function loadBoard() {
        const status = $('board-status');
        const sel = $('board-game-select');
        try {
            const res = await fetch('/api/board', { cache: 'no-store' });
            const data = await res.json();
            boardGames = data.games || [];
            if (sel) {
                sel.innerHTML = '';
                if (!boardGames.length) {
                    sel.innerHTML = '<option value="">No games configured</option>';
                } else {
                    const ph = document.createElement('option');
                    ph.value = '';
                    ph.textContent = '— Select a game —';
                    sel.appendChild(ph);
                    boardGames.forEach(g => {
                        const opt = document.createElement('option');
                        opt.value = g.id;
                        opt.textContent = g.label || (g.name + ' (' + (g.systemLabel || 'D&D') + ')');
                        sel.appendChild(opt);
                    });
                }
            }
            if (status) status.textContent = '';
            onGameSelectChange();
        } catch (e) {
            if (status) status.textContent = 'Could not load Game Board.';
            console.error(e);
        }
    }

    function onGameSelectChange() {
        const sel = $('board-game-select');
        const id = sel && sel.value;
        selectedGame = boardGames.find(g => g.id === id) || null;
        const meta = $('board-game-meta');
        const pinBlock = $('board-pin-block');
        const pinHint = $('board-pin-hint');
        const pinLabel = $('board-pin-label');
        const btn = $('board-unlock-btn');
        const pinInput = $('board-game-pin');

        if (!selectedGame) {
            if (meta) meta.textContent = '';
            if (pinBlock) pinBlock.style.display = 'none';
            return;
        }

        if (meta) {
            meta.textContent =
                (selectedGame.systemLabel || 'D&D') +
                (selectedGame.campaignCount
                    ? ' · ' + selectedGame.campaignCount + ' campaign(s) on disk'
                    : ' · blank / empty table') +
                (selectedGame.needsPinSetup ? ' · first-time PIN setup' : '');
        }

        setupMode = !!selectedGame.needsPinSetup;
        if (pinBlock) pinBlock.style.display = 'block';
        if (pinInput) pinInput.value = '';
        if (pinHint) {
            pinHint.textContent = setupMode
                ? 'No table PIN yet. Choose a PIN (4+ chars) that players will use to open this game tonight.'
                : 'Enter the shared table PIN for this game (not the DM Notes PIN).';
        }
        if (pinLabel) {
            const lab = pinLabel.querySelector('input') ? null : null;
            // update label text node
            pinLabel.childNodes[0].textContent = setupMode ? 'Create game PIN ' : 'Game PIN ';
        }
        if (btn) {
            btn.innerHTML = setupMode
                ? '<i class="fa-solid fa-shield-halved"></i> Set PIN & enter table'
                : '<i class="fa-solid fa-door-open"></i> Enter table';
        }
    }

    async function unlockOrSetup() {
        const status = $('board-status');
        if (!selectedGame) {
            if (status) status.textContent = 'Select a game first.';
            return;
        }
        const pin = ($('board-game-pin') && $('board-game-pin').value) || '';
        if (pin.length < 4) {
            if (status) status.textContent = 'PIN must be at least 4 characters.';
            return;
        }
        if (status) status.textContent = 'Checking…';
        try {
            const path = setupMode || selectedGame.needsPinSetup
                ? '/api/board/setup-pin'
                : '/api/board/unlock';
            const res = await fetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId: selectedGame.id, pin })
            });
            const data = await res.json();
            if (res.status === 428 || data.needsPinSetup) {
                setupMode = true;
                selectedGame.needsPinSetup = true;
                onGameSelectChange();
                if (status) status.textContent = data.error || 'Set a table PIN first.';
                return;
            }
            if (!res.ok) {
                if (status) status.textContent = data.error || 'Unlock failed';
                return;
            }
            GameAccess.set({
                gameAccessToken: data.gameAccessToken,
                gameId: data.gameId,
                gameName: data.gameName,
                systemLabel: data.systemLabel,
                expiresAt: data.expiresAt
            });
            if (status) status.textContent = '';
            showEntry();
            await loadEntry();
        } catch (e) {
            if (status) status.textContent = 'Network error';
            console.error(e);
        }
    }

    async function loadEntry() {
        const status = $('entry-status');
        if (!GameAccess.token()) {
            showBoard();
            return;
        }
        try {
            const res = await fetch('/api/entry', {
                cache: 'no-store',
                headers: GameAccess.headers()
            });
            if (res.status === 401) {
                GameAccess.clear();
                SeatSession.clear();
                showBoard();
                await loadBoard();
                return;
            }
            const data = await res.json();
            const g = GameAccess.get();
            const sys = $('entry-game-system');
            if (sys) sys.textContent = (g && g.systemLabel) || 'D&D';

            const title = data.campaignName || data.gameName || (g && g.gameName) || 'Table';
            $('entry-campaign-name').textContent = title;

            const img = $('entry-map-image');
            const empty = $('entry-map-empty');
            if (img) {
                if (data.mapImage) {
                    img.style.display = 'block';
                    img.src = data.mapImage;
                    img.alt = title;
                    if (empty) empty.style.display = 'none';
                } else {
                    img.style.display = 'none';
                    img.removeAttribute('src');
                    if (empty) empty.style.display = 'flex';
                }
            }

            const list = $('entry-character-list');
            list.innerHTML = '';
            if (!data.ready || !data.characters || !data.characters.length) {
                list.innerHTML =
                    '<p class="entry-hint">' +
                    escapeHtml(
                        data.message ||
                            'No characters yet — this table is blank. Enter as DM to set up, or Import a saved D&D campaign.'
                    ) +
                    '</p>';
            } else {
                data.characters.forEach(ch => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'entry-seat-btn' + (ch.claimed ? ' claimed' : '');
                    btn.innerHTML =
                        '<span class="entry-seat-name">' +
                        escapeHtml(ch.name) +
                        '</span>' +
                        '<span class="entry-seat-meta">' +
                        escapeHtml(
                            [ch.player, ch.class, ch.level != null && ch.level !== '' ? 'Lvl ' + ch.level : '']
                                .filter(Boolean)
                                .join(' · ')
                        ) +
                        '</span>' +
                        (ch.claimed
                            ? '<span class="entry-seat-badge">In use' +
                              (ch.claimLabel ? ': ' + escapeHtml(ch.claimLabel) : '') +
                              '</span>'
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
                headers: GameAccess.headers(),
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
                headers: GameAccess.headers(),
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
            if (!t || !GameAccess.token()) return;
            try {
                const res = await fetch('/api/seats/heartbeat', {
                    method: 'POST',
                    headers: SeatSession.headers(),
                    body: JSON.stringify({})
                });
                if (res.status === 401) {
                    await leaveGameFully();
                }
            } catch (e) {
                /* ignore */
            }
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
            } catch (e) {
                /* ignore */
            }
        }
        SeatSession.clear();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        showEntry();
        loadEntry();
    }

    async function leaveGameFully() {
        const t = SeatSession.token();
        if (t) {
            try {
                await fetch('/api/seats/release', {
                    method: 'POST',
                    headers: SeatSession.headers(),
                    body: JSON.stringify({})
                });
            } catch (e) {
                /* ignore */
            }
        }
        try {
            await fetch('/api/board/leave', {
                method: 'POST',
                headers: GameAccess.headers(),
                body: JSON.stringify({})
            });
        } catch (e) {
            /* ignore */
        }
        SeatSession.clear();
        GameAccess.clear();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        showBoard();
        await loadBoard();
    }

    window.leaveSeatAndReturn = leaveSeat;
    window.leaveGameAndReturn = leaveGameFully;

    document.addEventListener('DOMContentLoaded', async () => {
        const dmBtn = $('entry-dm-submit');
        if (dmBtn) dmBtn.addEventListener('click', claimDm);
        const refreshBtn = $('entry-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', loadEntry);
        const leaveGameBtn = $('entry-leave-game');
        if (leaveGameBtn) leaveGameBtn.addEventListener('click', leaveGameFully);
        const boardLeave = $('btn-leave-game');
        if (boardLeave) boardLeave.addEventListener('click', leaveGameFully);

        const sel = $('board-game-select');
        if (sel) sel.addEventListener('change', onGameSelectChange);
        const unlockBtn = $('board-unlock-btn');
        if (unlockBtn) unlockBtn.addEventListener('click', unlockOrSetup);
        const pinInput = $('board-game-pin');
        if (pinInput) {
            pinInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') unlockOrSetup();
            });
        }

        // Resume paths
        const game = GameAccess.get();
        const seat = SeatSession.get();

        if (game && game.gameAccessToken && seat && seat.sessionToken) {
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
            } catch (e) {
                /* fall through */
            }
            SeatSession.clear();
        }

        if (game && game.gameAccessToken) {
            // validate game token via entry
            try {
                const res = await fetch('/api/entry', {
                    cache: 'no-store',
                    headers: GameAccess.headers()
                });
                if (res.ok) {
                    showEntry();
                    await loadEntry();
                    setInterval(() => {
                        if (GameAccess.token() && $('entry-screen') && $('entry-screen').style.display !== 'none') {
                            loadEntry();
                        }
                    }, 8000);
                    return;
                }
            } catch (e) {
                /* fall through */
            }
            GameAccess.clear();
        }

        showBoard();
        await loadBoard();
    });
})();
