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

**Theme (next):** safer admin / first-run clarity and table QoL — Reset/Import gates, map asset UX, cheaper sync, backup restore UI.

**Theme (landed v1):** multi-device trust — middle-path split files, entry seats, claim/offer/DM force, DM prep lock + Characters-panel tools.

**Plan (detailed):** `.hermes/plans/2026-08-22_185542-middle-path-character-files-dm-lock.md`

### Feature tracker

| ID | Item | Status | Notes |
|----|------|--------|--------|
| F0 | Entry / seat page | **Done (v1)** | Map + campaign name + character list + DM PIN; claim before main app (`seat-entry.js`) |
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
| F4 | Safer Reset & Import | **Backlog** | Gate or stronger confirm; Import preview; safer large export |
| F5 | Schema `version` on saves | **Done (v1)** | `schemaVersion: 2` in manifest |
| F6 | Missing map / asset UX | **Backlog** | Clear in-app message when map file 404s |
| F7 | localStorage vs server authority | **Done (v1)** | Server snapshot authoritative; local cache strips UI-only fields |
| F8 | Full re-render / poll cost | **Backlog** | Cheaper sync when unchanged |
| F9 | In-app restore from rolling backups | **Backlog** | Backups on disk; surface later |
| F10 | DM-gated admin actions | **Backlog** | Reset, import, etc. |

Update this table when focus changes.

### Completed summary (v1 multi-device + DM sheet UX)

- **Server/store:** versioned multi-file campaign store; one-time migrate from `campaign_state.json`; seats/sessions; claim; helper offers; DM force; prep lock.
- **Client:** entry gate → claim → main app; piecewise saves (holder character + shared map/combat/meta); poll `/api/snapshot`; Accept/Deny / DM reload notices; sync chrome.
- **DM Characters flow:** pick tab → **Lock This Sheet** → **Edit Character Specs** → save → **Unlock**; status line shows working-on / locked without early word-wrap.
- **Not done yet:** push to shared `main`, map symlink/asset message, safer Reset/Import, in-app backup restore, cheaper poll.

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

4. **Reset / Import power** — **Open (F4 / F10)**  
   Available in main UI to anyone who can open the URL. One confirm dialog is easy to accept by mistake; Import replaces live state.

5. **Export via data-URI** — **Open**  
   Can fail or choke on larger states; Blob download is more reliable.

6. **No schema version** — **Addressed (v1 / F5)**  
   Manifest carries `schemaVersion: 2`.

7. **Missing map asset** — **Open (F6)**  
   Default expects `phandelver-map-exterior-player.webp` (or `mapImage` path). File is intentionally not in git. UI should explain a 404 instead of a blank map.

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

14. **Seed vs empty start** — **Open**  
    Defaults are Beer Club / Phandelver-oriented. Fine for this table; a blank campaign path helps testing without stomping mental models.

### P3 — maintainability (POC health)

15. **Large monolithic front end** (`app.js`) — harder to review and test.  
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

### 2026-08-23

- **DM / Characters UX polish (local/dev):** moved Lock/Unlock from sidebar onto Characters panel; fixed unlock enable (`locks` → `dmEditLocks`); **Edit Character Specs** disabled for DM until sheet locked; full-width nowrap status line; Edit modal ability scores vertical; Equipment inventory scroll host (scroll works; arrow cursor on scrollbar).
- Documented completion of F0–F3, F5, F7, F2d–F2h in this file; next focus F4 / F6 / F8–F10.

### 2026-08-22

- Collaborator access established; clone under development machines as needed.
- Added gitignore entries for local-only notes and local data dirs (`LOCAL_NOTES.md`, `data-local/`, related patterns) so personal/dev artifacts stay off the shared history when those rules are committed.
- Documented self-hosted POC framing and technical backlog in **this file** (`DEVELOPMENT.md`).
- Confirmed map art is **not** shipped in git; hosts supply `mapImage` (e.g. symlink/copy of `phandelver-map-exterior-player.webp` beside the app). HTTP 404 on that path is expected until the host adds the file.
- Local dev pattern validated: branch such as `local/dev`, `DATA_DIR=…/data-local node server.js`, UI on port **8080** (compose maps **8082→8080** on typical Docker hosts).
- **Architecture decision then implemented (middle-path v1 on local/dev):** multi-file characters + entry seat page + claim/holder writes; helper changes → Accept/Deny with diff; DM force apply + Reload prompt; DM prep lock. Files: `lib/store.js`, `seat-entry.js`, rewired `server.js` / `app.js` / `index.html` / `style.css`. Curl-verified claim, offer accept, stale 409, DM force, prep lock 423. Plan: `.hermes/plans/2026-08-22_185542-middle-path-character-files-dm-lock.md`.

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
| Middle-path plan | `.hermes/plans/2026-08-22_185542-middle-path-character-files-dm-lock.md` |
| This status file | `DEVELOPMENT.md` |
