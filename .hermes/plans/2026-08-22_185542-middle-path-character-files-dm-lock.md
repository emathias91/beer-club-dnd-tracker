# Middle Path data model + seat claims + DM override — Implementation Plan

> **For Hermes:** Use subagent-driven-development (or Claude Code) to implement this plan task-by-task after user approval. **Do not start coding until the user says to execute.**

**Goal:** Stop silent whole-campaign clobbers by splitting **characters** into versioned files (combat/map/meta separate), assemble a combined UI snapshot, and control who can change a sheet via:

1. An **entry / seat-select page** (map + campaign name + character list + DM).  
2. **Player claim** — choosing a character opens the main app as that seat and binds writes to that browser session.  
3. **Helper / other edits** — if someone else changes a claimed sheet, the **active player** gets **Accept / Deny** with a summary of what changed (so a friend can track HP while you’re away, but nothing sticks without awareness).  
4. **DM** — always may change anything (PIN); active player is told **“DM changed … — Reload”** (no deny).  
5. **DM correction lock** (optional overlay) — DM can still hard-lock a sheet for prep edits when needed.

**Architecture:** Self-hosted Node stdlib server. On disk under `DATA_DIR`:

```text
DATA_DIR/
  manifest.json
  campaign/<campaignId>/
    meta.json                 # name, mapImage, sessionLogs — revisioned
    map.json                  # markers, partyPosition — revisioned
    combat.json               # combatants, round, rolls — revisioned
    characters/<charId>.json  # sheet + revision + claim + pendingOffers
  sessions.json               # lightweight seat sessions (or embed in character docs)
  dm_notes.json               # existing PIN flow
```

**Tech stack:** Node `http`, vanilla JS/CSS/HTML, no new npm deps.

**North star:** Middle path (multi-file characters first) + **entry seats** + **claim / offer / DM force**.

---

## Simple problem statement (for humans)

Today one big save means two people can erase each other’s work.

We will:

- Give each character their **own save file** (and separate files for map/combat).  
- Open the site on a **“who are you?”** page: pretty map, campaign title, buttons for each PC + DM.  
- When you pick **your** character, the app knows that’s your seat and **your** edits apply normally.  
- If **someone else** changes your sheet (helping with HP, etc.), **you** see what they changed and **Accept** or **Deny**.  
- If the **DM** changes your sheet, you just get **Reload** (DM always wins).  

---

## User experience

### Entry page (`/` or `/join` — default landing)

Layout:

| Region | Content |
|--------|---------|
| **Top** | Campaign name |
| **Right (or large panel)** | Campaign map only (same `mapImage` / party token optional; keep simple: map image + pins read-only) |
| **Left / bottom list** | One row/button per character (name, player name if known, class/level optional) + **DM** at bottom |
| **DM control** | Opens PIN entry, then full app as **role=dm** (all characters, combat, notes, admin) |
| **Busy seats** | Show “In use by …” if claimed (heartbeat); allow **Take over?** only with confirm + knocks previous to read-only/offer mode (v1: confirm steal claim after timeout or explicit “I’m back”) |

Choosing a character:

1. `POST /api/seats/claim` with `{ campaignId, characterId, displayName? }`.  
2. Server returns `sessionToken`, seat info.  
3. Browser stores token (`sessionStorage`).  
4. Navigate to main app ` /app` or `/?seat=1` with main shell.  
5. Main app loads snapshot; focuses that character; treats session as **holder**.

### Main app (player seat)

- Full tracker UI, but **primary edit target** = claimed character (other sheets read-only or “view only” unless offering help — v1: other sheets view-only for players).  
- Map / combat / rolls: policy v1 — **players may write combat HP for their character + shared rolls**; DM writes all combat. (Refine in open questions; default: players write own character file + append own rolls; combat tracker DM-preferred but player can update own combatant row linked to claim.)

### Someone else edits your claimed character

Two sub-cases:

**A) Editor is not DM** (helper on another device, or second browser):

- Their save does **not** overwrite the live sheet blindly.  
- Server stores a **pending offer** (diff or full proposed `data` + summary + fromSession + timestamp).  
- Holder’s client (poll) shows modal:

  > **Elowen was modified**  
  > • HP 27 → 22  
  > • Status: add Prone  
  > From: “Helper tablet”  
  > **[Accept] [Deny]**

- **Accept** → apply offer to live character, bump revision, clear offer, notify helpers.  
- **Deny** → drop offer; helper’s view reloads to live data.

**B) Editor is DM** (valid PIN on write or DM session):

- Change applies **immediately** to live character.  
- Holder sees non-blocking or modal:

  > **DM changed Elowen**  
  > HP, equipment, … (short summary)  
  > **[Reload sheet]**

- No Deny. Reload pulls latest snapshot for that character.

### DM correction lock (retained from earlier plan)

- DM may **Lock for editing** (prep): blocks new **player** offers and player direct writes; DM writes still apply (force path).  
- **Unlock** when done.  
- Distinct from **seat claim** (claim = who is the active player at the table).

---

## Core concepts

| Term | Meaning |
|------|---------|
| **Seat claim** | Browser session is the **holder** for character X |
| **sessionToken** | Secret id stored in browser; sent on character writes |
| **Direct write** | Holder (or DM) updates live `data` + revision |
| **Offer** | Non-holder proposed change awaiting Accept/Deny |
| **DM force** | Live apply + `lastDmForce` notice for holder UI |
| **Revision** | Monotonic per file; stale holder writes still 409 if two holder tabs |

---

## Data shapes

### Character document

```json
{
  "revision": 12,
  "updatedAt": "ISO-8601",
  "claim": {
    "sessionId": "uuid",
    "label": "Denise's phone",
    "claimedAt": "ISO-8601",
    "lastSeen": "ISO-8601"
  },
  "dmEditLock": null,
  "dmEditLock": { "at": "ISO-8601", "note": "spell prep" },
  "pendingOffers": [
    {
      "id": "offer-uuid",
      "fromSessionId": "uuid",
      "fromLabel": "Chris helper",
      "createdAt": "ISO-8601",
      "baseRevision": 11,
      "summary": ["HP 27 → 22", "Notes: …"],
      "proposedData": { }
    }
  ],
  "lastDmForce": {
    "at": "ISO-8601",
    "summary": ["HP 22 → 18", "Equipment updated"],
    "seenByHolder": false
  },
  "data": { }
}
```

### sessions registry (optional file)

```json
{
  "sessions": {
    "uuid": {
      "role": "player" | "dm",
      "characterId": "Elowen" | null,
      "label": "Denise's phone",
      "createdAt": "...",
      "lastSeen": "..."
    }
  }
}
```

Heartbeat: `POST /api/seats/heartbeat` every ~30s; claim expires after **N minutes** without heartbeat (default **15 min**) so a dead phone doesn’t block the table forever. On expiry, pending offers remain until Accept/Deny or auto-drop on next claim (document choice: **clear offers on new claim**).

---

## Target API

### Seats / entry

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/entry` | Campaign name, mapImage, characters[{id,name,player,class,claim status}], dmConfigured |
| POST | `/api/seats/claim` | Claim character → `{ sessionToken, role:'player', characterId }` |
| POST | `/api/seats/dm` | Body `{ pin, label? }` → `{ sessionToken, role:'dm' }` |
| POST | `/api/seats/heartbeat` | Keep claim alive |
| POST | `/api/seats/release` | Leave seat voluntarily |
| POST | `/api/seats/steal` | Optional: take over claim after confirm (releases previous) |

### Snapshot / pieces

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/snapshot` | Full UI assembly + revisions + claims + offers relevant to caller (Authorization: Bearer session or header `X-Session-Token`) |
| GET | `/api/characters/:id` | One character doc (strip secrets) |
| PUT | `/api/characters/:id` | Write attempt — see rules below |
| POST | `/api/characters/:id/offers/:offerId/accept` | Holder accepts |
| POST | `/api/characters/:id/offers/:offerId/deny` | Holder denies |
| POST | `/api/characters/:id/dm-lock` | DM edit lock on |
| POST | `/api/characters/:id/dm-unlock` | DM edit lock off |
| PUT | `/api/combat` | revisioned |
| PUT | `/api/map` | revisioned |
| PUT | `/api/meta` | revisioned |

### Character PUT rules (authoritative)

Request body:

```json
{
  "baseRevision": 12,
  "data": { },
  "label": "optional helper name"
}
```

Headers: `X-Session-Token: …`

Server logic:

1. Validate session.  
2. Load character doc.  
3. If `baseRevision !== doc.revision` → **409** stale (holder should reload; helper’s offer based on old base may be rejected or stored with warning).  
4. If session **role === dm`** → apply live, set `lastDmForce` summary (diff against previous data), clear conflicting offers or keep — **default: clear pending offers** on DM force, bump revision, **200**.  
5. Else if session is **claim holder** for this id:  
   - If `dmEditLock` set → **423** locked by DM for prep.  
   - Else apply live, clear `lastDmForce.seen` as needed, bump revision, **200**.  
6. Else (other player / unclaimed helper):  
   - If `dmEditLock` → **423**.  
   - If **no claim** on character → either allow direct write (open seat) OR require claim first. **Default: unclaimed → direct write allowed** (first touch); optional “soft claim” on first write. **Preferred with entry page: must claim to enter app**, so main path always has claim.  
   - If claimed by someone else → **do not apply live**; compute diff summary; push `pendingOffers` (cap e.g. 5); **202 Accepted** `{ offerId, summary }`; helper UI shows “Waiting for player approval”.  
7. Atomic write always.

### Accept / Deny

- **Accept:** only claim holder session (or DM). Apply `proposedData` if `offer.baseRevision` still matches **or** re-diff — **v1: require offer.baseRevision === current.revision** else 409 “offer outdated, helper must resubmit”. Apply, revision++, remove offer.  
- **Deny:** remove offer; **200**.

### Diff summary helper

Server-side shallow/deep diff of known fields: `hp`, `ac`, key resources, spells expended, conditions/notes if present, equipment string. Human lines for the modal. No need for perfect semantic diff in v1.

---

## Front-end structure

| Page | Files (suggested) |
|------|-------------------|
| Entry | `join.html` **or** `index.html` mode `data-mode=entry` + `join.js` |
| Main app | current `index.html` shell → move to `app.html` **or** show/hide roots in one page |

**Recommendation:** single `index.html` with two roots `#entry-screen` and `#app-shell` to avoid asset path churn; entry is default when no valid sessionToken.

### Entry UI tasks

- Campaign title, map panel, character list, DM button + PIN modal.  
- Poll `/api/entry` lightly so claim badges update.  

### Main UI tasks

- On load: validate session; if missing → entry.  
- Holder: normal edits → PUT (direct).  
- Poll snapshot: if `pendingOffers.length` for my character → Accept/Deny modal (queue if multiple).  
- If `lastDmForce && !seenByHolder` → “DM changed … Reload” modal; on Reload mark seen (POST ack) + refresh character.  
- Non-holder viewing/helping: editing claimed char sends offer; toast “Sent to player for approval”.  
- Status strip: Live / Saving / Pending approval / Conflict / DM updated.

### Local UI state

Never server-truth: zoom, panel, modal open — `sessionStorage`.

---

## Migration

Unchanged from prior plan: monolith `campaign_state.json` → split files + backup. Claims empty after migrate. `schemaVersion: 2`.

---

## Implementation tasks (updated order)

### Task 0: User approval of this plan revision

No code.

### Task 1: Disk helpers + versioned docs

`lib/store.js` — atomic read/write, paths.

### Task 2: Migrator monolith → split

`lib/migrate.js` + startup hook.

### Task 3: Sessions + entry API

`GET /api/entry`, claim, dm seat, heartbeat, release.

### Task 4: Snapshot API includes claims/offers/dmForce

### Task 5: Character PUT (holder / offer / DM force) + diff summary

### Task 6: Accept / Deny + DM ack force seen

### Task 7: Combat / map / meta PUT + revision

### Task 8: DM edit-lock endpoints (prep lock)

### Task 9: Entry page UI (map, list, DM PIN)

### Task 10: Main app session gate + local UI split

### Task 11: Wire character saves to PUT rules; helper offer UX

### Task 12: Holder Accept/Deny modal + DM Reload modal

### Task 13: Polling, 409 handling, status strip

### Task 14: Docs — `DEVELOPMENT.md`, `README.md` short UX note

### Task 15: Smoke checklist (two phones + DM)

---

## Smoke checklist (human)

- [ ] Entry shows map + names + DM  
- [ ] Claim Elowen on phone A; phone B claims Thorin; both edit OK  
- [ ] Phone B opens Elowen as helper, changes HP → A gets Accept/Deny with summary  
- [ ] A Accept → both see new HP; A Deny → HP reverts for B  
- [ ] DM PIN seat changes Elowen → A sees Reload only (no Deny); after reload data matches  
- [ ] DM prep lock blocks player offers/writes  
- [ ] Heartbeat expiry releases stale claim  
- [ ] Zoom on A does not affect B  
- [ ] Migrate old save once with backup  

---

## Risks and tradeoffs

| Risk | Mitigation |
|------|------------|
| Offer UX mid-combat lag | Keep summaries short; allow multiple rapid offers coalesced (v1.1) |
| Diff too noisy | Limit fields in v1 summary list |
| Stolen phone seat | Heartbeat expiry + release; steal with confirm |
| Two tabs same player | Same sessionToken (duplicate tab) OK; second browser = second session → offers or steal |
| Helper frustration if always deny | Social; optional later “trusted helper” |
| Implementation size | Server rules first (curl), then entry UI, then modals |

---

## Out of scope

- Real user accounts / passwords per player  
- CRDT automatic merge  
- SaaS  
- Full VTT  

---

## Open questions (defaults)

| Question | Default |
|----------|---------|
| Can players edit shared combat tracker? | Own combatant row + rolls; full initiative DM |
| Steal claim immediately? | Confirm dialog; previous session becomes non-holder |
| Max pending offers | 5; oldest dropped with notice |
| Entry map interactive? | Read-only image + pins v1 |
| Store sessionToken | `sessionStorage` (per tab) vs `localStorage` (per browser) — **sessionStorage** default so two tabs can be two seats if needed |

---

## Success criteria

1. Different claimed characters edit in parallel without clobber.  
2. Same character: non-holder changes require **Accept/Deny** with visible modification list.  
3. DM changes apply immediately; holder gets **Reload**, not Deny.  
4. Entry page is the default door into the app.  
5. Middle-path multi-file storage + migration works on `data-local`.  

---

## Relation to earlier P0 list

| P0 | How this plan addresses it |
|----|----------------------------|
| Last-write-wins | Per-file revision + offers instead of blind full-state POST |
| UI mixed into shared state | Local-only zoom/tab; seats are explicit |
| Silent failures | Status strip + modals for pending/DM/conflict |

---

## After approval

Implement Task 1→15 on `local/dev`, `DATA_DIR=data-local`, no push until smoke pass.
