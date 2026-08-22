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

---

## Current focus

**Theme:** make multi-device use trustworthy and obvious (sync + feedback), without expanding into a different product category.

| ID | Item | Status | Notes |
|----|------|--------|--------|
| F1 | Shared vs local UI state | **Next** | Stop syncing zoom / active character / map chrome as part of the server document |
| F2 | Stale-save / revision protection | **Next** | Version or token so last-write-wins does not silently drop edits |
| F3 | Visible connection + save status | **Next** | Online / saved / error / conflict — not only `console` |
| F4 | Safer Reset & Import | Backlog | Gate or stronger confirm; Import preview; safer large export |
| F5 | Schema `version` on saves | Backlog | Enables safe migrations as the POC evolves |
| F6 | Missing map / asset UX | Backlog | Clear in-app message when map file 404s |
| F7 | localStorage vs server authority | Backlog | Server mode: cache only; never overwrite newer server blindly |
| F8 | Full re-render / poll cost | Backlog | Cheaper sync when unchanged; less jank on poll |
| F9 | In-app restore from rolling backups | Backlog | Backups already on disk; surface to DM/admin |
| F10 | DM-gated admin actions | Backlog | Reset, import, campaign-destroying settings |

Update this table when focus changes. Keep **one** primary theme at a time when possible.

---

## Known issues & QoL backlog

Priorities are for a **home self-hosted POC**, not a commercial roadmap.

### P0 — data loss / multi-device trust

1. **Last-write-wins**  
   Clients POST the entire campaign JSON. Concurrent edits can overwrite each other. Polling defers only while focus is in an input/modal; many real actions (HP clicks, dice, initiative, party token) do not block inbound sync or outbound clobber.

2. **Personal UI mixed into shared state**  
   Fields such as active character, zoom, and transient map UI flags are saved with the document and can affect other clients on poll/save.

3. **Silent save/sync failure**  
   Network or HTTP errors are mostly logged to the console. Users get no durable “not saved” / “offline” signal.

### P1 — footguns and first-run clarity

4. **Reset / Import power**  
   Available in main UI to anyone who can open the URL. One confirm dialog is easy to accept by mistake; Import replaces live state.

5. **Export via data-URI**  
   Can fail or choke on larger states; Blob download is more reliable.

6. **No schema version**  
   Migrations and compatibility checks are ad hoc; a `version` (or similar) on the save document should exist before larger structural edits.

7. **Missing map asset**  
   Default expects `phandelver-map-exterior-player.webp` (or `mapImage` path). File is intentionally not in git. UI should explain a 404 instead of a blank map.

8. **localStorage dual path**  
   Server mode also writes localStorage. A stale cache after outage can later POST over newer server data if authority rules are wrong.

### P2 — feel and ops at the table

9. **Poll + full `renderAll()`**  
   ~3s full fetch and broad re-render; fine for a small table and small JSON, gets noisier as history/logs grow.

10. **Rolling backups are server-only**  
    Excellent on disk; no first-class UI to list/restore the last N saves.

11. **Level-up partial automation**  
    Modifiers recalculate; HP max and spell slots remain manual — easy to forget mid-session.

12. **No compact party combat overview**  
    Sheets are one character at a time; running the table’s HP at a glance is awkward (QoL for the DM, not new content).

13. **Mobile / small screens**  
    Some breakpoints exist; map + dense sheets remain awkward on phones. Tablets matter more than phones for this POC.

14. **Seed vs empty start**  
    Defaults are Beer Club / Phandelver-oriented. Fine for this table; a blank campaign path helps testing without stomping mental models.

### P3 — maintainability (POC health)

15. **Large monolithic front end** (`app.js`) — harder to review and test.  
16. **Little or no automated test coverage** — especially around sync.  
17. **Admin vs player** — no light role split beyond DM notes PIN.  
18. **Observability** — basic request logging only; “who saved last” would help debug table nights.

### Explicitly deferred (not current POC goals)

- Multi-tenant cloud hosting, accounts/billing, public internet exposure as a default.  
- Full VTT (maps with fog, tokens combat grid, etc.) competitor scope.  
- Bundling copyrighted adventure maps or official branding in the repo.

---

## Design notes (for upcoming focus work)

### Shared document vs local UI (F1)

**Should sync (campaign truth):** campaigns, characters, combatants, combat round/index, roll history, session logs, map markers, party position, campaign-level settings that all players must see.

**Should stay per-browser (local):** selected character tab, map zoom/pan, modal open state, “adding marker” chrome, ephemeral animations, maybe last-viewed panel.

Server POST body should be the **shared document** only (or the server should strip local keys). Poll apply must not stomp local UI fields.

### Revision / conflict (F2)

Minimal direction (implementation TBD):

- Server assigns monotonically increasing `revision` (or hash) on each successful save.  
- Client sends last-seen revision with POST.  
- Mismatch → **409** + current document; client shows conflict and offers reload (or careful merge later).  
- Reject empty/no-campaign payloads (already partly done).

### Status UI (F3)

States users should recognize without opening devtools: **Live**, **Saving…**, **Saved**, **Offline / unreachable**, **Conflict — reload**.

---

## History

Newest first. Record shared, meaningful changes (behavior, repo process, fixes). Skip pure personal env details.

### 2026-08-22

- Collaborator access established; clone under development machines as needed.
- Added gitignore entries for local-only notes and local data dirs (`LOCAL_NOTES.md`, `data-local/`, related patterns) so personal/dev artifacts stay off the shared history when those rules are committed.
- Documented self-hosted POC framing and technical backlog in **this file** (`DEVELOPMENT.md`).
- Confirmed map art is **not** shipped in git; hosts supply `mapImage` (e.g. symlink/copy of `phandelver-map-exterior-player.webp` beside the app). HTTP 404 on that path is expected until the host adds the file.
- Local dev pattern validated: branch such as `local/dev`, `DATA_DIR=…/data-local node server.js`, UI on port **8080** (compose maps **8082→8080** on typical Docker hosts).

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
| Client | `app.js`, `index.html`, `style.css` |
| Seed data | `data.js` |
| Container | `Dockerfile`, `docker-compose.yml` |
| This status file | `DEVELOPMENT.md` |
