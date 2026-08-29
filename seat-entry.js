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
        const NEW_GAME_VALUE = '__new__';
        const IMPORT_GAME_VALUE = '__import__';
        let _boardImportParsed = null;

        async function loadBoard() {
            const status = $('board-status');
            const sel = $('board-game-select');
            try {
                const res = await fetch('/api/board', { cache: 'no-store' });
                const data = await res.json();
                boardGames = data.games || [];
                if (sel) {
                    sel.innerHTML = '';
                    const ph = document.createElement('option');
                    ph.value = '';
                    ph.textContent = 'Select Game';
                    sel.appendChild(ph);

                    boardGames.forEach(g => {
                        const opt = document.createElement('option');
                        opt.value = g.id;
                        opt.textContent = g.label || (g.name + ' (' + (g.systemLabel || 'D&D') + ')');
                        sel.appendChild(opt);
                    });

                    const ng = document.createElement('option');
                    ng.value = NEW_GAME_VALUE;
                    ng.textContent = 'New Game';
                    sel.appendChild(ng);

                    const ig = document.createElement('option');
                    ig.value = IMPORT_GAME_VALUE;
                    ig.textContent = 'Import Game';
                    sel.appendChild(ig);
                }
                if (status) status.textContent = '';
                onGameSelectChange();
            } catch (e) {
                if (status) status.textContent = 'Could not load Game Board.';
                console.error(e);
            }
        }

        function hideBoardForms() {
            const pinBlock = $('board-pin-block');
            const newBlock = $('board-new-game-block');
            const importBlock = $('board-import-game-block');
            if (pinBlock) pinBlock.style.display = 'none';
            if (newBlock) newBlock.style.display = 'none';
            if (importBlock) importBlock.style.display = 'none';
        }

        function onGameSelectChange() {
            const sel = $('board-game-select');
            const id = sel && sel.value;
            const meta = $('board-game-meta');
            const pinBlock = $('board-pin-block');
            const newBlock = $('board-new-game-block');
            const pinHint = $('board-pin-hint');
            const pinLabel = $('board-pin-label');
            const btn = $('board-unlock-btn');
            const pinInput = $('board-game-pin');
            const status = $('board-status');
            if (status) status.textContent = '';

            selectedGame = null;
            setupMode = false;

            if (!id) {
                hideBoardForms();
                if (meta) meta.textContent = boardGames.length
                    ? ''
                    : 'No games on this board yet. Choose New Game to create one.';
                return;
            }

            if (id === NEW_GAME_VALUE) {
                hideBoardForms();
                if (meta) {
                    meta.textContent = 'Create a new table with its own table PIN and DM PIN (they must differ).';
                }
                if (newBlock) newBlock.style.display = 'block';
                ['board-new-game-name', 'board-new-game-pin', 'board-new-game-pin2',
                    'board-new-dm-pin', 'board-new-dm-pin2'].forEach(fid => {
                    const el = $(fid);
                    if (el) el.value = '';
                });
                const nameEl = $('board-new-game-name');
                if (nameEl) setTimeout(() => nameEl.focus(), 30);
                return;
            }

            if (id === IMPORT_GAME_VALUE) {
                hideBoardForms();
                _boardImportParsed = null;
                if (meta) {
                    meta.textContent = 'Import a saved game JSON. PINs in the file are restored when present.';
                }
                const importBlock = $('board-import-game-block');
                if (importBlock) importBlock.style.display = 'block';
                const fileEl = $('board-import-file');
                if (fileEl) fileEl.value = '';
                const fileMeta = $('board-import-file-meta');
                if (fileMeta) fileMeta.textContent = 'Choose a .json export file.';
                ['board-import-table-pin', 'board-import-dm-pin'].forEach(fid => {
                    const el = $(fid);
                    if (el) el.value = '';
                });
                const btn = $('board-import-game-btn');
                if (btn) btn.disabled = true;
                updateBoardImportPinVisibility();
                return;
            }

            selectedGame = boardGames.find(g => g.id === id) || null;
            if (!selectedGame) {
                hideBoardForms();
                if (meta) meta.textContent = '';
                return;
            }

            if (newBlock) newBlock.style.display = 'none';
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
            if (pinLabel && pinLabel.childNodes[0]) {
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

        async function createNewGame() {
            const status = $('board-status');
            const name = ($('board-new-game-name') && $('board-new-game-name').value || '').trim();
            const pin = ($('board-new-game-pin') && $('board-new-game-pin').value) || '';
            const pin2 = ($('board-new-game-pin2') && $('board-new-game-pin2').value) || '';
            const dmPin = ($('board-new-dm-pin') && $('board-new-dm-pin').value) || '';
            const dmPin2 = ($('board-new-dm-pin2') && $('board-new-dm-pin2').value) || '';
            if (!name) {
                if (status) status.textContent = 'Enter a name for the new game.';
                return;
            }
            if (pin.length < 4) {
                if (status) status.textContent = 'Table PIN must be at least 4 characters.';
                return;
            }
            if (pin !== pin2) {
                if (status) status.textContent = 'The two table PINs do not match.';
                return;
            }
            if (dmPin.length < 4) {
                if (status) status.textContent = 'DM PIN must be at least 4 characters.';
                return;
            }
            if (dmPin !== dmPin2) {
                if (status) status.textContent = 'The two DM PINs do not match.';
                return;
            }
            if (dmPin === pin) {
                if (status) status.textContent = 'DM PIN must be different from the table PIN.';
                return;
            }
            if (status) status.textContent = 'Creating game…';
            try {
                const res = await fetch('/api/board/create-game', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name,
                        pin,
                        pinConfirm: pin2,
                        dmPin,
                        dmPinConfirm: dmPin2
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    if (status) status.textContent = data.error || 'Could not create game.';
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
                await loadBoard();
                showEntry();
                await loadEntry();
            } catch (e) {
                if (status) status.textContent = 'Network error';
                console.error(e);
            }
        }

        function packageHasTablePin(pkg) {
            const a = pkg && (pkg.tableAccess || pkg.access);
            return !!(a && a.pinHash && a.salt);
        }
        function packageHasDmPin(pkg) {
            const a = pkg && (pkg.dmAccess || pkg.dmNotes || pkg.dm);
            return !!(a && a.pinHash && a.salt);
        }

        function updateBoardImportPinVisibility() {
            const wrap = $('board-import-pin-fields');
            if (!wrap) return;
            const pkg = _boardImportParsed;
            if (!pkg) {
                wrap.style.display = 'block';
                return;
            }
            const needTable = !packageHasTablePin(pkg);
            const needDm = !packageHasDmPin(pkg);
            wrap.style.display = (needTable || needDm) ? 'block' : 'none';
            const tableLab = $('board-import-table-pin') && $('board-import-table-pin').closest('label');
            const dmLab = $('board-import-dm-pin') && $('board-import-dm-pin').closest('label');
            if (tableLab) tableLab.style.display = needTable ? '' : 'none';
            if (dmLab) dmLab.style.display = needDm ? '' : 'none';
        }

        function onBoardImportFileChange() {
            const status = $('board-status');
            const fileEl = $('board-import-file');
            const btn = $('board-import-game-btn');
            const fileMeta = $('board-import-file-meta');
            _boardImportParsed = null;
            if (btn) btn.disabled = true;
            const file = fileEl && fileEl.files && fileEl.files[0];
            if (!file) {
                if (fileMeta) fileMeta.textContent = 'Choose a .json export file.';
                updateBoardImportPinVisibility();
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const parsed = JSON.parse(String(reader.result || ''));
                    if (!parsed || typeof parsed !== 'object') throw new Error('Not a JSON object');
                    const camps = parsed.campaigns || (parsed.state && parsed.state.campaigns);
                    if (!Array.isArray(camps) || !camps.length) {
                        throw new Error('File needs a non-empty campaigns array');
                    }
                    _boardImportParsed = parsed;
                    const name = parsed.gameName || parsed.name || camps[0].name || 'Imported Game';
                    const pins = [];
                    if (packageHasTablePin(parsed)) pins.push('table PIN in file');
                    if (packageHasDmPin(parsed)) pins.push('DM PIN in file');
                    if (fileMeta) {
                        fileMeta.textContent = file.name + ' · ' + name +
                            (pins.length ? ' · ' + pins.join(', ') : ' · pins needed below');
                    }
                    if (btn) btn.disabled = false;
                    updateBoardImportPinVisibility();
                    if (status) status.textContent = '';
                } catch (e) {
                    _boardImportParsed = null;
                    if (fileMeta) fileMeta.textContent = 'Could not read file: ' + (e.message || e);
                    if (btn) btn.disabled = true;
                    updateBoardImportPinVisibility();
                }
            };
            reader.onerror = () => {
                if (fileMeta) fileMeta.textContent = 'Could not read file.';
                if (btn) btn.disabled = true;
            };
            reader.readAsText(file);
        }

        async function importGameFromBoard() {
            const status = $('board-status');
            if (!_boardImportParsed) {
                if (status) status.textContent = 'Choose an import file first.';
                return;
            }
            const pkg = Object.assign({}, _boardImportParsed);
            if (!packageHasTablePin(pkg)) {
                pkg.tablePin = ($('board-import-table-pin') && $('board-import-table-pin').value) || '';
                if (pkg.tablePin.length < 4) {
                    if (status) status.textContent = 'Enter a table PIN (4+ chars) — file has none.';
                    return;
                }
            }
            if (!packageHasDmPin(pkg)) {
                pkg.dmPin = ($('board-import-dm-pin') && $('board-import-dm-pin').value) || '';
                if (pkg.dmPin.length < 4) {
                    if (status) status.textContent = 'Enter a DM PIN (4+ chars) — file has none.';
                    return;
                }
                if (pkg.tablePin && pkg.dmPin === pkg.tablePin) {
                    if (status) status.textContent = 'DM PIN must differ from table PIN.';
                    return;
                }
            }
            if (status) status.textContent = 'Importing game…';
            try {
                const res = await fetch('/api/board/import-game', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(pkg)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    if (status) status.textContent = data.error || 'Import failed';
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
                await loadBoard();
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
                    const raw = String(data.mapImage);
                    const src = raw.startsWith('/maps/') || /^https?:/i.test(raw)
                        ? raw
                        : (/\/|\.webp|\.png|\.jpe?g|\.gif|\.svg/i.test(raw)
                            ? (raw.startsWith('/') ? raw : '/maps/' + encodeURIComponent(raw.split(/[\\/]/).pop()))
                            : raw);
                    img.src = src;
                    img.alt = title;
                    img.onerror = function () {
                        img.style.display = 'none';
                        if (empty) empty.style.display = 'flex';
                    };
                    img.onload = function () {
                        if (empty) empty.style.display = 'none';
                    };
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
                        (ch.passphraseRequired
                            ? '<span class="entry-seat-badge dm" title="Character passphrase required"><i class="fa-solid fa-key"></i> Code</span>'
                            : '') +
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
        let passphrase = ($('entry-char-passphrase') && $('entry-char-passphrase').value) || '';
        if (ch.passphraseRequired && !passphrase) {
            passphrase = prompt(
                'Enter the passphrase for ' + (ch.name || 'this character') + ':',
                ''
            ) || '';
            if (!passphrase) {
                alert('This character requires a passphrase to sit.');
                return;
            }
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
                    steal,
                    passphrase
                })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'Could not claim seat');
                loadEntry();
                return;
            }
            // Clear passphrase field after successful claim
            if ($('entry-char-passphrase')) $('entry-char-passphrase').value = '';
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
        if (!pin || pin.length < 4) {
            alert('Enter the DM PIN (set when the game was created).');
            return;
        }
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
        const createBtn = $('board-create-game-btn');
        if (createBtn) createBtn.addEventListener('click', createNewGame);
        ['board-new-game-name', 'board-new-game-pin', 'board-new-game-pin2',
            'board-new-dm-pin', 'board-new-dm-pin2'].forEach(id => {
            const el = $(id);
            if (el) {
                el.addEventListener('keydown', e => {
                    if (e.key === 'Enter') createNewGame();
                });
            }
        });
        const importFile = $('board-import-file');
        if (importFile) importFile.addEventListener('change', onBoardImportFileChange);
        const importBtn = $('board-import-game-btn');
        if (importBtn) importBtn.addEventListener('click', importGameFromBoard);

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
