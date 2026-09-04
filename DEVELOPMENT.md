# Development status — Beer Club D&D Campaign Tracker

**Audience:** anyone working on this repo (local or collaborators).  
**Scope:** self-hosted, personal / table-use program. This tree is the **internal proof of concept** before any larger rewrite or different product direction.

This file is **tracked in git** so the whole group can see priorities and history.  
Machine-only notes (paths, personal scratch) stay in `LOCAL_NOTES.md` (gitignored).

---

## What we are building

A **self-hosted campaign dashboard** for a home table:

- Runs on a home box (Node or Docker); shared over LAN (or VPN such as Tailscale).
- One shared campaign state, character sheets, map, dice/combat, session logs.
- PIN-gated DM notes kept out of the broadcast state.
- No cloud accounts required for the POC.

**Out of scope for this document and for current POC work:** SaaS, multi-tenant hosting, commercial packaging, marketplace/competitor positioning, and business/legal go-to-market. Revisit only if the project’s goals change explicitly.

---

## How we work (conventions)

| Topic | Practice |
|--------|----------|
| Shared default branch | `main` — matches upstream; avoid breaking the live table without agreement |
| Experimental work | Local branches (e.g. `local/dev`); push/PR only when ready to share |
| Live campaign data | Never commit `data/`, saves, backups, or DM notes (see `.gitignore`) |
| Maps / art | Not in git (copyright). Hosts supply files beside the app or via asset paths |
| Personal scratch | `LOCAL_NOTES.md` (ignored) — not a substitute for this file |
| Focus | Prefer reliability and QoL at the table over new adventure content |
| UI layout | Left sidebar = navigate; **right panel owns actions** for that view (self-contained) |

---

## Current focus

**Theme (next):** cheaper sync (F8), backup restore UI (F9), multi-game board polish / blank game factory.

**Theme (landed):** multi-device trust v1; F4 safer Import/Reset; **Game Board** landing with per-game table PIN + LMoP as a real game (blank D&D template for Reset).

Design summary lives in **this file** (below) and in History. Detailed local planning notes stay on each contributor’s machine (not in git).

### Feature tracker

| ID | Item | Status | Notes |
|----|------|--------|--------|
| F0 | Entry / seat page | **Done (v1)** | After game unlock; map + seats + DM Notes PIN |
| F0b | Game Board + table PIN | **Done (v1)** | Dropdown of games; table PIN unlock; data under `games/<id>/` |
| F0c | Blank D&D template | **Done (v1)** | Reset → empty table (not seed party); LMoP keeps live data |
| F1 | Shared vs local UI state | **Done (v1)** | Zoom/tab local only (`dnd_local_ui`); not in server docs |
| F2 | Split files + per-doc revision | **Done (v1)** | `lib/store.js`; migrate from monolith; `DATA_DIR/campaign/<id>/{meta,map,combat}.json` + `characters/*.json` |
| F2b | Seat claim + helper offers | **Done (v1)** | Holder direct write; others → pending offer; Accept/Deny + summary |
| F2c | DM force apply | **Done (v1)** | DM session writes live; holder “DM changed … Reload” |
| F2d | DM prep lock | **Done (v1)** | Lock/Unlock on **Characters panel** (not sidebar); player writes **423** while locked |
| F2e | DM Edit Specs gated on lock | **Done (v1)** | **Edit Character Specs** greyed until **Lock This Sheet**; open modal also guards |
| F2f | Panel self-contained chrome | **Done (v1)** | Status line full-width nowrap under Characters header |
| F2g | Edit modal ability layout | **Done (v1)** | Ability scores stack vertically (STR→CHA), not 6-across |
| F2h | Equipment inventory scroll UX | **Done (v1)** | Scroll host owns bar (arrow cursor); textarea keeps text caret; still scrolls |
| F3 | Visible connection + save status | **Done (v1)** | `#sync-status` Live / Saving / Conflict / Offline |
| F4 | Safer Reset & Import | **Done (v1)** | Preview + type `IMPORT`; Reset type `RESET`; Blob export; full `/api/state` replace; Import/Reset DM-seat only |
| F5 | Schema `version` on saves | **Done (v1)** | `schemaVersion: 2` in manifest |
| F6 | Missing map / asset UX | **Done (v1)** | Overlay title/body distinguish "no map set" vs "map file failed to load" (DM vs player copy); corrupt-but-200 image also now surfaces an error |
| F7 | localStorage vs server authority | **Done (v1)** | Server snapshot authoritative; local cache strips UI-only fields |
| F8 | Full re-render / poll cost | **Backlog** | Cheaper sync when unchanged |
| F9 | In-app restore from rolling backups | **Backlog** | Backups on disk; surface later |
| F10 | DM-gated admin actions | **Partial (v1)** | Import/Reset DM-only via seats (F4); other admin still open |

Update this table when focus changes.

### Completed summary (v1 multi-device + DM sheet UX)

- **Server/store:** versioned multi-file campaign store; one-time migrate from `campaign_state.json`; seats/sessions; claim; helper offers; DM force; prep lock.
- **Client:** entry gate → claim → main app; piecewise saves (holder character + shared map/combat/meta); poll `/api/snapshot`; Accept/Deny / DM reload notices; sync chrome.
- **DM Characters flow:** pick tab → **Lock This Sheet** → **Edit Character Specs** → save → **Unlock**; status line shows working-on / locked without early word-wrap.
- **Not done yet:** map symlink/asset message (F6), cheaper poll (F8), full in-app backup restore (F9), remaining admin gates.

---

## Known issues & QoL backlog

Priorities are for a **home self-hosted POC**, not a commercial roadmap.

### P0 — data loss / multi-device trust

| # | Issue | Status |
|---|--------|--------|
| 1 | Last-write-wins (monolithic full-state POST) | **Addressed (v1)** — split docs + revisions + offers (F2 / F2b) |
| 2 | Personal UI mixed into shared state | **Addressed (v1)** — F1 |
| 3 | Silent save/sync failure | **Addressed (v1)** — F3 |
| 4 | No seat identity / unaware helper edits | **Addressed (v1)** — F0 / F2b / F2c |

Residual risk: full `POST /api/state` still exists for import/compat paths; prefer piece APIs in normal play.

### P1 — footguns and first-run clarity

4. **Reset / Import power** — **Addressed (v1 / F4)** (+ partial F10)  
   Import preview + type `IMPORT`; Reset type `RESET`; DM seat required when seats active; full server replace. Export uses Blob download.

5. **Export via data-URI** — **Addressed (v1 / F4)**  
   Blob + object URL download of shared document only.

6. **No schema version** — **Addressed (v1 / F5)**  
   Manifest carries `schemaVersion: 2`.

7. **Missing map asset** — **Addressed (v1 / F6)**  
   Default expects `phandelver-map-exterior-player.webp` (or `mapImage` path). File is intentionally not in git. Error detection + a status line already shipped 2026-08-30; this pass closes the remaining gap where the overlay headline read "No map uploaded" even when a specific file was set but failed to load.

8. **localStorage dual path** — **Addressed (v1 / F7)**  
   Server snapshot is authoritative; local cache is subordinate.

### P2 — feel and ops at the table

9. **Poll + full `renderAll()`** — **Open (F8)**  
   ~3s full fetch and broad re-render; fine for a small table and small JSON, gets noisier as history/logs grow.

10. **Rolling backups are server-only** — **Open (F9)**  
    Event-driven on full monolith-style saves (cap **30**); **not** a timer; piece saves do not create `campaign_state.backup-*`. No first-class UI to list/restore.

11. **Level-up partial automation** — **Open**  
    Modifiers recalculate; HP max and spell slots remain manual — easy to forget mid-session.

12. **No compact party combat overview** — **Open**  
    Sheets are one character at a time; running the table’s HP at a glance is awkward (QoL for the DM, not new content).

13. **Mobile / small screens** — **Open**  
    Some breakpoints exist; map + dense sheets remain awkward on phones. Tablets matter more than phones for this POC.

14a. **Save-before-revisions-loaded can silently no-op** — **Open, found 2026-09-03**  
    `smartSaveToServer()` (`js/sync.js`) gates each piece-save on `typeof state.revisions[key] === 'number'` with no fallback for the "haven't loaded a snapshot yet" case; a save attempted in that narrow window updates the UI locally but never PUTs to the server, and a later poll cycle silently reverts it. Found during Phase 6 module-split verification (pre-existing, not a regression from that phase). Low severity in practice (revisions populate almost immediately after boot) but worth a real fix — e.g. `saveState()` awaiting `loadState()` once if revisions are empty.

14. **Seed vs empty start** — **Addressed (2026-08-25/26)**  
    Empty table heal loop fixed; **Create Campaign** on map empty state + Campaign Settings guarded when no active campaign; blank create uses full `POST /api/state`.

### P3 — maintainability (POC health)

15. **Large monolithic front end** (`app.js`) — harder to review and test. **In progress, nearly done:** converting to ES modules (`js/` directory), one subsystem extracted per phase (see History). `app.js` is down from ~5,934 lines to 713 as of Phase 10 (2026-09-04); remaining: Phase 11 (`js/importExport.js`) and Phase 12 (final cleanup of what's left — boot/nav/render orchestration).  
16. **Little or no automated test coverage** — especially around sync (ad-hoc scripts only in local work).  
17. **Admin vs player** — seats + DM prep lock are a start; Reset/Import still not DM-gated (F10).  
18. **Observability** — basic request logging only; “who saved last” would help debug table nights.

### Explicitly deferred (not current POC goals)

- Multi-tenant cloud hosting, accounts/billing, public internet exposure as a default.  
- Full VTT (maps with fog, tokens combat grid, etc.) competitor scope.  
- Bundling copyrighted adventure maps or official branding in the repo.

---

## Design notes (landed + remaining)

### Shared document vs local UI (F1) — landed

**Syncs (campaign truth):** campaigns, characters, combatants, combat round/index, roll history, session logs, map markers, party position, campaign-level settings all players must see.

**Per-browser (local):** selected character tab, map zoom/pan, modal open state, “adding marker” chrome, ephemeral UI.

### Revision / conflict (F2) — landed (v1)

- Per-document `revision` on character / map / combat / meta.  
- Client sends last-seen revision; mismatch → **409** + current doc.  
- Helper non-holders → **202** pending offer; holder Accept/Deny.  
- DM writes apply; holder prompted to reload.  
- Prep lock → player write **423** until DM unlocks.

### Status UI (F3) — landed

Recognize without devtools: **Live**, **Saving…**, **Conflict — reload**, **Offline / unreachable** (and related save chrome).

### DM Characters panel flow (F2d–F2f) — landed

1. Left nav → **Characters**  
2. Right panel → pick character tab  
3. **Lock This Sheet** → **Edit Character Specs** → save → **Unlock This Sheet**  
4. Status row under header (single line when width allows)

### Backups (ops note)

- **Not scheduled.** Rolling `campaign_state.backup-*.json` on full `POST /api/state` (and migrate), keep **30**.  
- Split-file piece saves: atomic write only; no extra rolling snapshot per edit.  
- In-app restore still **F9**.

---

## History

Newest first. Record shared, meaningful changes (behavior, repo process, fixes). Skip pure personal env details.

### 2026-09-04 / app.js module split — Phase 10: characters.js (P3 #15)

- **`js/characters.js`**: the biggest phase by far (~1,860 lines, 33 exports) — the full character sheet subsystem: DM lock chrome (`updateCharSheetChrome`, `dmToggleCharLock`), core render (`renderCharacterTabs`, `renderSelectedCharacter`), equipment (parse/format/render/add/remove/transfer + `initEquipmentInventory`), skills (get/render/add-custom + `initSkillsPanel`), backstory/player-private-notes (`setBackstoryTab`, `renderBackstoryAndTraits`, `renderPlayerPrivateNotes`, `initPlayerNotesUi`), resources/rests (`renderCharacterResources`, `applyRest`, `initRestButtons`), coins (`renderCoins`), the modifier-recalculation pair (`ensureProficiencyFlags`, `recalculateCharacterModifiers`), and the char-specs/HP modals (`openEditCharSpecsModal`, `openHPModal`) with their Save handlers folded into `initCharacterPanel` (same `initModals()`-extraction pattern as Phases 6-9).
- Kept as one file per the earlier decision (still ~3x smaller than the original app.js).
- `canEditPlayerPrivate` moves here from app.js — it was already circularly imported by `js/sync.js` (from Phase 4); repointed to `./characters.js`, joining the established sibling-circular-import pattern. No other module needed anything from this subsystem via a hidden circular edge (checked the whole `js/` directory, not just app.js, per the Phase 8 lesson) — every cross-reference was caught up front this time.
- `app.js`: 2,568 → **713 lines**.
- Thoroughly browser-verified directly (dialog overrides from the start, given the scale): character sheet render, HP damage via the folded-in modal handler, ability-check roll → combat panel navigation, Lock/Unlock sheet, Edit Character Specs → full modifier recalculation (confirmed STR score change propagated to both the ability card and the Strength skill), short rest, coin purse edit, and equipment add — all correct, console clean throughout.

### 2026-09-03 / app.js module split — Phase 9: campaigns.js (P3 #15)

- **`js/campaigns.js`**: campaign settings + CRUD — `initCampaignSettings`, `openDeleteCampaignModal`, `deleteCampaignById`, `buildStarterCharacter`, `buildBlankCampaign`, `createBlankCampaign`, `openCampaignSettingsModal`, `updateEmptyCampaignChrome`, `renderCampaignSelector`.
- **Corrected a stale claim from the original exploration/plan**: `openDeleteCampaignModal`/`deleteCampaignById` looked nested inside `initCampaignSettings` from their indentation, but direct brace-tracing showed they're already top-level functions — no restructuring needed, just moved as plain exports. (Second time this session a prior summary didn't hold up under direct verification — see also Phase 3's `state` reassignment correction.)
- Simplest phase yet: no `initModals()` extraction needed, since all this subsystem's modal handlers already lived inside `initCampaignSettings` itself.
- Two more circular-import repoints, both caught up front this time (lesson from Phase 8 applied): `js/sync.js`'s existing `renderCampaignSelector` import (from Phase 4) repointed from `../app.js` to `./campaigns.js`; `js/map.js`'s existing `updateEmptyCampaignChrome` import (from Phase 7) repointed the same way — now a second sibling-to-sibling pair (`map.js` ↔ `campaigns.js`, alongside `combat.js` ↔ `sessionLogs.js`).
- `app.js`: 3,073 → 2,568 lines.
- Browser-verified directly: Campaign Settings modal, Clone Campaign (full create path, not just the button wiring), and Delete Campaign — all correct, console clean throughout.

### 2026-09-03 / app.js module split — Phase 8: combat.js (P3 #15)

- **`js/combat.js`**: the entire combat tracker + dice roller + party-on-tracker helpers — 30 functions total, the largest single phase so far: `initDefaultCombatants`, `partyCharactersForCombat`, `combatantMatchesParty`, `isPartyMemberInCombat`, `parseOptionalCombatNumber`, `combatInitSortValue`, `buildCombatantFromParty`, `ensureAllPartyOnTracker`, `renderPartyQuickAddList`, `openAddCombatantModal`, `rollForCharacter`, `switchToCombatPanel`, `initCombatPanel`, `markCombatLocalEdit`, `saveCombatNow`, `sortCombatantsByInitiative`, `moveCombatant`, `getDiceRollerName`, `rollDie`, `formatDieFace`, `getDiceCount`, `resetDiceCountToOne`, `renderDiceFaces`, `rollDice`, `renderRollHistory`, `renderInitiativeList`, `nextCombatTurn`, `resetCombatTracker`, `sortInitiativeList`, `updateCombatAndSessionChrome`.
- Same pattern again: "Save Combatant (Initiative)" handler moved out of `initModals()`'s grab-bag into `initCombatPanel()`.
- **New pattern: sibling-to-sibling circular import.** `js/combat.js` needs `updateSessionLogChrome` from `js/sessionLogs.js`; `js/sessionLogs.js` needs `getDiceRollerName`, which moved here — so `sessionLogs.js`'s import was repointed from the old `../app.js` circular edge to `./combat.js` instead. `js/sync.js` also needed `getDiceRollerName` for its own `logRoll` (repointed the same way, from `../app.js` to `./combat.js`) — this is the first phase where two *feature* modules reference each other directly, not just "feature module ↔ app.js." Same safety argument applies (function-body-only usage) and it verified working correctly.
- Applied the Phase 7 lesson: checked every one of the 30 exports' `app.js` reference counts systematically before removing. Caught two real external callers this time (`rollForCharacter`/`switchToCombatPanel`, called from character-sheet roll buttons; `initDefaultCombatants`/`rollDie`/`renderRollHistory`/`renderInitiativeList`/`updateCombatAndSessionChrome`, called from campaign CRUD, character-sheet weapon rolls, and nav/render code) and imported them all correctly the first time — `app.js` booted clean on the first real browser load this phase.
- **Caught and fixed one more bug anyway, from a different cause**: forgot that `js/sync.js` *also* had its own circular import of `getDiceRollerName` from `../app.js` (predating this phase, from Phase 4) — removing the name from `app.js`'s export list broke that second, less obvious reference. Fixed by repointing `sync.js`'s import to `./combat.js` too. **Lesson refined further: when moving a function that other modules already reach via a circular `../app.js` import, grep the whole `js/` directory for that name, not just `app.js` itself** — `grep -rn "functionName" js/*.js app.js`.
- `app.js`: 3,842 → 3,073 lines.
- Browser-verified directly (not delegated to a fork, given the fork dialog-freeze issue from Phase 7): boot, a d20 roll through the full `rollDice` → `logRoll` → `renderRollHistory` chain, Next Turn (round advance), Add Combatant via the folded-in save handler, and Session Logs panel (exercising the new sibling circular import) — all correct, console clean.

### 2026-09-03 / app.js module split — Phase 7: map.js (P3 #15)

- **`js/map.js`**: the entire Map panel subsystem — `resolveCampaignMapUrl`, `showMapMissing`, `updateMapUploadChrome`, `bindMapImageLifecycle` (the F6 missing-map-overlay fix travels intact), `uploadMapFile`, `applyUploadedMap`, `openMapFilePicker`, `openAddMarkerModal`, `openEditMarkerModal`, `initMapPanel`, `renderMapMarkers`, `showMarkerDetails`, `showPartyDetails`.
- Same Phase-6 pattern: the "Save Map Pin" handler moved out of `initModals()`'s grab-bag into `initMapPanel()`.
- New circular-import edge: `js/map.js` ↔ `app.js` for `updateEmptyCampaignChrome` (not extracted yet, moves in the Campaigns phase), same safe pattern as the others.
- `app.js`: 4,364 → 3,842 lines.
- **Caught a real bug during verification** (fixed before commit, not shipped broken): `updateAdminToolsChrome()` (still in `app.js`) called `updateMapUploadChrome()` directly, but that function moved to `js/map.js` without being imported back — threw `ReferenceError` on every DM boot, silently swallowed by a `catch` block that called a blocking `alert()` before `console.error()`, which froze the tab (this is why the first verification attempt hung with no visible error — traced by overriding `window.alert`/`confirm`/`prompt` before reproducing). Fixed by adding `updateMapUploadChrome` to `app.js`'s import from `js/map.js`. Re-verified clean afterward: boot, DM chrome, character sheet, marker add via the moved Save handler, zoom.
- **Process note:** earlier phases only spot-checked a few function names for external callers before removing them from `app.js`; this phase's larger function count (13) meant a spot-check missed one. Going forward, check *every* exported name's app.js reference count systematically (`grep -c` per name) before removing, not just the ones that seem likely to be called elsewhere.

### 2026-09-03 / app.js module split — Phase 6: sessionLogs.js (P3 #15)

- **`js/sessionLogs.js`**: `getSessionActorName`, `formatSessionAdditionTime`, `renderSessionLogBody`, `renderSessionLogsList`, `displaySessionDetail`, `openNewSessionLogModal`, `openEditSessionLogModal`, `openAddToSessionLogModal`, `updateSessionLogChrome`, `initSessionLogsPanel`.
- **First phase to restructure `initModals()`** rather than move whole functions verbatim: the "Save Session Log" and "Player/DM append to log" click handlers used to live inline inside `app.js`'s grab-bag `initModals()` — moved out and folded into `initSessionLogsPanel()` instead (both still get called unconditionally during boot, so wiring order doesn't matter). This is the pattern the plan flagged as needing careful per-domain carving rather than a verbatim cut.
- Same established circular-import pattern reused for `getDiceRollerName` (from `../app.js`).
- `app.js`: 4,715 → 4,364 lines.
- Browser-verified with extra attention on the restructured handlers: create a new log, add a party addition, edit an existing log — all save/render correctly.

### 2026-09-03 / app.js module split — Phase 5: dmNotes.js (P3 #15)

- **`js/dmNotes.js`**: the PIN-gated DM Notes subsystem — `dmShow`, `dmApi`, `refreshDmGate`, `dmSetStatus`, `initDmPanel`, `dmState`. Confirmed physically misplaced inside app.js's old "Character Sheet" section comment despite being unrelated — now its own module.
- Clean extraction, no circular import needed — only depends on `sessionHeaders` from `js/sync.js` (normal one-directional import). `app.js` now imports just `initDmPanel`, the only cross-reference from outside this subsystem. `app.js`: 4,909 → 4,715 lines.
- Browser-verified: unlock with DM PIN, edit notes, autosave POST to `/api/dm-notes/save` round-trips, and the re-lock-on-navigate-away behavior all work identically to before.

### 2026-09-03 / app.js module split — Phase 4: sync.js (P3 #15)

- **`js/sync.js`**: the entire sync core — `sessionHeaders`, `setSyncStatus`, `applyServerSnapshot`, `checkSeatClaimStillMine`, `loadState`, `loadStateFromLocalStorage`, `saveState`, `queueSmartSave`, `saveStateToServer`, `smartSaveToServer` (~280 lines, moved whole per the earlier risk note), `showOfferPendingToast`, `processSeatNotices`, `isModalOpen`, `isUserEditing`, `isSharedStateEqual`, `startPollingSync`, `resetToDefaults`, `logRoll` (the shared activity-log helper), plus `IS_SERVER_MODE`. `app.js`: 5,770 → 4,909 lines.
- **First use of a circular import in this migration**: `js/sync.js` imports `renderAll`, `renderCampaignSelector`, `canEditPlayerPrivate`, `buildSharedExportPayload`, `getDiceRollerName` back from `app.js` (which now explicitly `export`s them) — these haven't moved to their own modules yet. Safe because every usage is inside a function body, never at module-eval time; documented with a comment at the top of `sync.js`. Will be cleaned up (import source updated, no longer circular) as each function moves in a later phase.
- **`_suppressCombatSyncUntil`** (unlike `state`, this one genuinely gets reassigned by code outside its owning module — combat's `markCombatLocalEdit`) is now private to `sync.js` with an exported setter `markCombatSyncSuppressedUntil(ms)`; `markCombatLocalEdit` (still in `app.js`, moves in the Combat phase) calls the setter instead of assigning directly.
- Browser-verified with the broadest pass yet: boot, a live character-HP-edit → debounced `smartSaveToServer` → network PUT round trip, a dice roll through `logRoll`, the 3s poll loop, and a full page reload re-fetching from `/api/snapshot`.

### 2026-09-03 / app.js module split — Phase 3: state.js (P3 #15)

- **`js/state.js`**: the shared `state` object, `LOCAL_UI_KEY`, `loadLocalUi`/`saveLocalUi`, `getActiveCampaign`, `getActiveCharacter`.
- `state` is exported as a `const` — confirmed (via direct code search, not assumption) that it's never wholesale-reassigned anywhere in the codebase, only mutated field-by-field (`state.campaigns = ...`), so a plain live-binding import is sufficient; no reassignment-safe wrapper needed.
- Riskiest phase so far (~50 functions read/write `state` across the whole app) — browser-verified with a broader pass than usual, including a full page-reload round-trip through `localStorage` to confirm `loadLocalUi`/`saveLocalUi` still restore `activeCharacterId`/`zoomLevel` correctly through the new module boundary.
- Also removed a stray orphaned section-comment left over from the Phase 1 extraction.

### 2026-09-03 / app.js module split — Phases 1-2: utils.js, auth.js (P3 #15)

- **`js/utils.js`**: `escapeHtml`, `signed`, `formatCombatHpDisplay`, `hpHealthColor`, `updateCharacterHpColor`, `fitTextareaInScrollHost`, `bindTextareaScrollHosts`, `downloadJsonBlob`, `playDiceSound`+`audioCtx` — generic, dependency-free helpers.
- **`js/auth.js`**: `canUseDestructiveAdmin`, `requireDmAction` — the DM/seat-role check, called from nearly every subsystem.
- `app.js` now imports both instead of defining them; verbatim code move, no logic changes.
- `Dockerfile` gets `COPY js ./js` (needed starting this phase — Phase 0 didn't create any files under `js/` yet).
- Browser-verified: no console errors, DM chrome/auth gating, HP color, and character rendering all unaffected.
- `app.js` line count: 5,934 → 5,770 (net, after Phase 0's small additions).

### 2026-09-03 / app.js module split — Phase 0 (P3 #15)

- **`app.js` is now an ES module.** `index.html` loads it as `<script type="module" src="app.js">`; the separate `<script src="data.js">` tag is removed since `app.js` imports it directly (`import { INITIAL_CHARACTER_DATA } from './data.js';`). `data.js`'s consts now use `export const`.
- **`window.setSyncStatus = setSyncStatus;`** added explicitly right after its definition — `seat-entry.js` (still a classic script) calls it off `window`, which ES modules don't populate implicitly. `window.bootCampaignApp` needed no change (already assigned via `window.` explicitly).
- **No code moved yet, no behavior change** — browser-verified: no console errors, DM boot/render/sync-status/modal flows all work identically to before.
- Why: `app.js` is 5,900+ lines and flagged by this doc itself (P3 #15) as hard to review/test. This is the foundation phase of a full split into `js/*.js` modules — later phases (utils, auth, state, sync core, then each feature subsystem) will extract one module at a time, each independently verified and committed, tracked against a saved plan rather than done in one pass.
- Scope: `app.js`, `data.js`, `index.html` only. `seat-entry.js` intentionally stays a classic script.

### 2026-09-03 / map-missing overlay: distinct 404 vs unset copy (F6)

- **Overlay title/body now differ by cause:** "No map uploaded" (mapImage unset) vs "Map file not found" (mapImage set but failed to load — 404 or corrupt). DM/player copy variants preserved for each.
- **`showMapMissing(show, message, reason)`** takes an explicit `'unset' | 'error'` reason, stored on `#map-missing-overlay.dataset.reason` so re-renders (role/seat refresh) keep the correct headline.
- **Corrupt-but-200 images** (load fires, `naturalWidth === 0`) now also surface the "Map file not found" state instead of silently rendering blank.
- Why: a DM with a broken map path was seeing the same "no map uploaded" headline as a table that never set one, sending them down the wrong troubleshooting path.
- Scope: `app.js` only; `seat-entry.js` pre-login preview intentionally left as the simpler duplicate (no DM/player branching there yet); no README changes (wording-only, no new operator-facing setup behavior).
- Also added a `LICENSE` (MIT) and a README link to it.

### 2026-08-30 / combat turn + session delete DM-only

- **Combat Turn Tracker:** **Next Turn**, **Reset Tracker**, **Add Combatant**, and **per-row Remove (delete combatant)** are **DM seat only** (hidden for players; handlers also guarded).
- **Reset Tracker:** drops NPC/monster rows, sets round/turn/init, and **re-adds every party character** from sheets (`ensureAllPartyOnTracker`).
- **Add Combatant:** quick-click list of party members **not already** on the tracker; custom NPC form remains. **Initiative optional** (blank OK). **HP optional** → shows **`??`** when unknown.
- **Session Logs:** **Delete Log** is DM-only (hidden + guarded). Edit/write still available as before.
- Players can still view the tracker and edit row HP/init if present; table flow controls are DM.

### 2026-08-30 / campaign CRUD + location note delete DM-only

- **Add Campaign / Delete Campaign** (map header) and **Start campaign** (empty table): **DM seat only** — hidden for players; create/delete/clone handlers guarded with `requireDmAction`.
- **Campaign Settings** create / clone / delete buttons: DM-only visibility.
- **Location pin Description & Notes → Delete**: DM-only (hidden for players; handler guarded). Edit remains available.

### 2026-08-30 / session log: Edit DM-only, Add to Log for party

- **Write New Log** / **Edit Log** / **Delete Log**: **DM only** (hidden + `requireDmAction` on open/save).
- **Add to Log** (players + DM): append signed note to selected session; stored in `log.additions[]` as `{ id, at, by, text }` — Edit Log does **not** wipe additions.
- Detail view shows main DM notes + **Party additions** with name + timestamp.
- Chrome: `updateSessionLogChrome()` from `updateCombatAndSessionChrome()`.

### 2026-08-30 / map upload DM-only + blank map copy

- **POST `/api/maps/upload`:** requires **DM seat** (403 otherwise). Game token alone is not enough.
- **PUT `/api/meta/:id`:** changing `mapImage` requires DM seat.
- **UI:** Browse / change-map hidden for players; blank overlay title **No map uploaded**; players see *Only the DM can upload a campaign map.* Seat-entry empty map copy matches.
- Campaign Settings map path field read-only for non-DM; settings save does not overwrite `mapImage` as player.

### 2026-08-29 / seat takeover revoke + notify (Ethan #3)

- **claimSeat:** on take-over, **revoke** previous session token so the loser cannot keep writing.
- **heartbeat:** if claim is held by another session → **409** `reason: seat_taken` and drop loser session.
- **putCharacter:** refuse stale “own seat” reclaim when claim is another session (`seat_taken`).
- **409 claim:** returns `canSteal: true` + claim label (no sessionId leak); entry UI offers takeover from **server** 409 (not only stale free-list flag).
- **Entry seat list** polls every **5s** while seat select is open.
- **In-app:** snapshot claims + 10s heartbeat surface “seat taken” → return to seat select.

### 2026-08-29 / DM Notes require DM seat (Ethan #2)

- All `/api/dm-notes/*` (status, setup, unlock, save, change-pin) require a valid **DM seat** session (`role === 'dm'`), then the notes PIN as before.
- Player seats: DM Notes nav/panel **hidden**; API returns **403**.
- Unconfigured notes PIN: `POST /api/seats/dm` grants a **bootstrap DM seat** (`needsDmPinSetup`) so only a DM can run setup (no player race on setup).
- Normal games (PIN set at New Game): Enter as DM still needs the DM PIN.

### 2026-08-27 / dual export + player-only notes

- **Export Game (DM):** `/api/export-package` requires **DM seat**; includes PIN material + DM notes. Client button gated with `canUseDestructiveAdmin()`.
- **Export Player Copy / My Character:** `/api/export-player` — requires player character seat; **only that character’s sheet** (incl. private notes/passphrase) + shared map/game data. No other PCs, no DM notes, no PIN hashes.
- **Character passphrase** gates `/api/seats/claim` when set (timing-safe compare). Entry screen shows “Code” badge + passphrase field. Empty passphrase = open seat until one is saved under Player Only Notes.

### 2026-08-26 / Import Game · Delete Game · export reminder

- **Board:** dropdown adds **Import Game** (file picker). Restores `tableAccess` + `dmAccess` PIN hashes from v2 packages; older campaign-only JSON asks for table + DM PIN at import.
- **Export Game** (in-app): `GET /api/export-package` includes campaigns + table/DM PIN material (`schemaHint: beer-club-dnd-game-v2`) and stamps `lastExportedAt`.
- **Delete Game** replaces Reset Board (DM, type `DELETE`) → removes board entry + `games/<id>/`, returns to Game Board.
- Sidebar banner if no export yet or last export older than **1 hour**.

### 2026-08-26 / New Game on empty board

- Empty Game Board dropdown: **Select Game** + **New Game** only (no pre-seeded LMoP stub).
- **New Game** → name + table PIN (confirm) + **DM PIN (confirm)** → `POST /api/board/create-game` writes fresh `access.json` + `dm_notes.json`. DM PIN must differ from table PIN.
- **Enter as DM** requires the DM PIN — no longer allows empty/any PIN when DM notes were unconfigured (`/api/seats/dm` → 428/401).
- Default `board.json` / `defaultBoard()` starts with `games: []`.

### 2026-08-26 / blank playground in Projects

- **Projects tree is the blank build/test target:** live LMoP `data-local` moved out of the repo to OneDrive `Documents/D&D/beer-club-live-backups/` (plus existing export JSONs there). Compose still mounts `./data-local` — it starts empty (`campaignCount: 0`, needs table PIN setup).
- **Removed tracked** `data-local-pre-board-latest/**` party files from the git index; tightened `.gitignore` for `data-local-*`, pre-board dirs, and stray game roots. History on remote may still contain old blobs until a separate history cleanup (not done here).
- **Real-data test pattern:** copy/clone project to a temp folder → run compose → Import export JSON (or restore a full `data-local-*` backup into that temp only). Do not put party data back into Projects if the goal is never shipping table data.

### 2026-08-26 / first-run empty table (P1)

- **Create Campaign:** map panel empty-state card + `createBlankCampaign()` full save; Campaign Settings opens safely with zero campaigns (clone/delete/save disabled until one exists).
- **DM Notes:** `/api/dm-notes/*` client calls now send `sessionHeaders()` (`X-Game-Token`) so status/setup/unlock stop 401ing after table unlock.
- **Placeholder bleed:** map heading defaults to “Campaign Map”; party position shows “—” until a campaign exists (no hardcoded Sword Coast / Phandalin).

### 2026-08-25 / empty-table boot loop (P0)

- **Bug (fresh install only):** after F0c blank template, `loadState()` treated `campaigns: []` as “needs heal,” called `resetToDefaults()` (still empty) + `saveStateToServer()` → trailing `loadState()` → infinite snapshot/state ping-pong (~25 req/s). Boot never finished wiring handlers → dead UI; backup rotation filled with identical empty posts in &lt;1s.
- **Fix:** accept empty campaigns on OK snapshot as valid; only seed blank on true **404**. Lives that already have party data (e.g. LMoP) were unaffected.
- **Follow-ups (2026-08-26):** Create Campaign empty-state path + DM Notes game token (see next History entry).

### 2026-08-23 (cont.) / portable run

- **Run anywhere:** `PORT` from env; listen `0.0.0.0`; `/api/health`; maps under `DATA_DIR/maps` + `/maps/*`; upload API `POST /api/maps/upload`; missing-map overlay + **Browse for map**; Docker Compose data volume + optional `./maps` mount; `.dockerignore`; README Docker section; placeholder SVG.
- **Game Board (F0b/F0c):** landing “Beer Club Game Board” with game dropdown; per-game **table PIN** (`/api/board/*`); campaign data under `DATA_DIR/games/<id>/` (LMoP migrated to `games/lmop`); Reset clears to **blank D&D** (not seed party). Seat select remains after unlock.
- **F4 Safer Reset & Import:** Import preview modal + type `IMPORT`; Reset type `RESET`; Blob export; full `/api/state` replace; Import/Reset DM-seat only (partial F10).
- **DM / Characters UX polish:** Lock/Unlock on Characters panel; Edit Specs gated on lock; status nowrap; vertical abilities; equipment scroll host.
- Documented F0–F4, F0b/c in this file; next focus F6 / F8–F9 / remaining F10 / multi-game factory.
- Removed agent-only local planning scratch from the repository (gitignored going forward); shared status remains in this file only.

### 2026-08-22

- Collaborator access established; clone under development machines as needed.
- Added gitignore entries for local-only notes and local data dirs (`LOCAL_NOTES.md`, `data-local/`, related patterns) so personal/dev artifacts stay off the shared history when those rules are committed.
- Documented self-hosted POC framing and technical backlog in **this file** (`DEVELOPMENT.md`).
- Confirmed map art is **not** shipped in git; hosts supply `mapImage` (e.g. symlink/copy of `phandelver-map-exterior-player.webp` beside the app). HTTP 404 on that path is expected until the host adds the file.
- Local dev pattern validated: branch such as `local/dev`, `DATA_DIR=…/data-local node server.js`, UI on port **8080** (compose maps **8082→8080** on typical Docker hosts).
- **Architecture decision then implemented (middle-path v1):** multi-file characters + entry seat page + claim/holder writes; helper changes → Accept/Deny with diff; DM force apply + Reload prompt; DM prep lock. Files: `lib/store.js`, `seat-entry.js`, rewired `server.js` / `app.js` / `index.html` / `style.css`. Curl-verified claim, offer accept, stale 409, DM force, prep lock 423.

### Earlier (upstream / pre-shared tracker)

From README changelog and code (summary only):

- Correctness: stored skill/save proficiencies; class save table; weapons store ability used.  
- Resources & rests (including Warlock short-rest slots).  
- Coins; PIN DM notes outside shared state.  
- Hardening: path traversal fix, atomic saves, rolling backups (cap 30), refuse empty campaign saves.  
- `repair-state.js` for one-off live save stat repair.

---

## Changelog discipline

When you land a shared change:

1. Short entry under **History** (date + what + why).  
2. Move or update rows in **Current focus** / backlog statuses.  
3. Keep README user-facing install/ops in sync if behavior operators rely on changes.  
4. Do not put secrets, PINs, or live `campaign_state` into this file.

---

## Quick links

| Resource | Location |
|----------|----------|
| User-facing docs | `README.md` |
| Server | `server.js` |
| Split store / seats / locks | `lib/store.js` |
| Entry / claim UI | `seat-entry.js` |
| Client | `app.js`, `index.html`, `style.css` |
| Seed data | `data.js` |
| Container | `Dockerfile`, `docker-compose.yml` |
| This status file | `DEVELOPMENT.md` |
