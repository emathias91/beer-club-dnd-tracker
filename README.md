# Beer Club D&D Campaign Tracker

A self-hosted, collaborative D&D campaign tracker. Runs on a home server and is
shared by the whole group over the local network — the DM updates HP or the
session log, and everyone's screen follows within a few seconds.

Built for a *Lost Mine of Phandelver* game, but campaign-agnostic: it supports
multiple campaigns, including homebrew.

---

## Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Run anywhere (Docker — recommended)](#run-anywhere-docker--recommended)
- [File map](#file-map)
- [Installing on ZimaOS](#installing-on-zimaos)
- [Everyday use](#everyday-use)
- [DM Notes and privacy](#dm-notes-and-privacy)
- [Backups and recovery](#backups-and-recovery)
- [Data model](#data-model)
- [Troubleshooting](#troubleshooting)
- [Known issues](#known-issues)
- [Changelog](#changelog)

---

## Features

**Campaign map** — pan and zoom, drop location pins with descriptions, and drag
a party token to show where the group currently is.

**Character sheets** — abilities, skills, saves, weapons, spells, spell slots,
features, equipment, backstory. All derived numbers recompute from the ability
scores and proficiency bonus, so levelling up means changing one field.

**Dice & combat** — dice tray, attack and check rolls straight from the sheets,
a shared roll history, initiative order and round tracking.

**Limited-use resources** — counters for things like Lay on Hands, Channel
Divinity, Wild Shape and Lucky points, each tagged to refill on a short rest,
a long rest, or manually.

**Rests** — Short Rest and Long Rest buttons that restore the correct HP, spell
slots and resources, including Warlock pact slots returning on a short rest.

**Coin purse** — PP/GP/EP/SP/CP per character with an automatic gold total.

**Session logs** — dated entries with a summary and full notes.

**Rules reference** — conditions and common rules lookups.

**DM Notes** — PIN-protected private notes, stored server-side so they never
reach a player's browser.

**Import / export** — download the whole campaign as JSON, or load one back.

---

## How it works

```
Browser (player)  ─┐
Browser (player)  ─┼──►  Node server on the home box  ──►  campaign_state.json
Browser (DM)      ─┘         (server.js, port 8080)    └─►  dm_notes.json
```

- The server does two jobs: serve the static front end, and hold the shared
  campaign state at `/api/state`.
- Every client polls for changes a few seconds apart, and posts the whole state
  when something is edited.
- If the server is unreachable — say the app is opened as a plain file — the
  front end falls back to browser local storage, and Import/Export becomes the
  way to move data around.
- DM notes are deliberately kept out of the shared state. See below.

No accounts, no cloud service, no external dependencies. The server uses only
the Node standard library.

---

## Run anywhere (Docker — recommended)

Same container image on **Linux, Windows, and macOS** (Docker Desktop or Engine).

### Requirements
- Docker + Docker Compose v2
- Git

### Start
```bash
git clone https://github.com/emathias91/beer-club-dnd-tracker.git
cd beer-club-dnd-tracker
mkdir -p maps
docker compose up -d --build
```

Open **http://localhost:8080** (or set `HOST_PORT=8082` in the environment).

### Maps (Option B + C)
Copyrighted maps are **not** in git.

1. **Drop files** into `./maps/` (e.g. `phandelver-map-exterior-player.webp`), **or**
2. In the app, open **Campaign Map** → **Browse for map…** (uploads into durable data volume under `DATA_DIR/maps/`).

A small placeholder SVG ships at `/maps/placeholder-map.svg` for smoke tests.

### Data
- Campaign board + games live in the bind-mounted host folder **`./data-local`** → container `/app/data` (see `docker-compose.yml`). A named volume `dnd-data` is an optional portable alternative (commented in compose).
- Survives rebuilds; wipe with `docker compose down -v` (destroys saves).

### Native Node (any OS, no Docker)
```bash
# Linux / macOS
export DATA_DIR="$(pwd)/data-local"
export PORT=8080
node server.js

# Windows PowerShell
$env:DATA_DIR = "$PWD\data-local"
$env:PORT = "8080"
node server.js
```
Put map files in `./maps/` or `data-local/maps/`, or upload in-app.

### Health check
```bash
curl -s http://127.0.0.1:8080/api/health
```

---

## File map

| File | Purpose |
|---|---|
| `index.html` | Layout and markup for every panel |
| `app.js` | All front-end logic — rendering, dice, sync, rests, DM panel |
| `data.js` | Seed data: starting characters, session logs, map pins |
| `style.css` | Styling |
| `server.js` | Static file server + state API + DM notes API |
| `Dockerfile` | Container image (Node 20 Alpine) |
| `docker-compose.yml` | Container definition, port mapping, volumes |
| `package.json` | Project metadata; `npm start` runs the server |
| `repair-state.js` | One-off utility that repaired corrupted character stats |
| `data/campaign_state.json` | **The live campaign.** Created at runtime |
| `data/dm_notes.json` | **Private DM notes + PIN hash.** Created at runtime |
| `data/campaign_state.backup-*.json` | Rolling automatic backups |

---

## Installing on ZimaOS

The app runs as a Docker container with the project folder bind-mounted, so
edits to the front-end files take effect on the next page load.

### 1. Put the files on the server

Upload the project into a folder under `/DATA/AppData/`, for example
`/DATA/AppData/Beer Club D&D`.

### 2. Create the container

Either paste `docker-compose.yml` into **App Store → Install a Custom App →
Docker Compose**, or from a terminal in the project folder:

```bash
sudo DOCKER_CONFIG=/tmp/.docker docker compose up --build -d
```

> ZimaOS keeps a read-only root filesystem and you are unlikely to be logged in
> as root, which is why Docker commands need `sudo` and the `DOCKER_CONFIG`
> override. Folder names containing spaces or `&` must be quoted:
> `cd "/DATA/AppData/Beer Club D&D"`.

### 3. Open it

```
http://<server-ip>:8082
```

Everyone on the network uses that same address. Bookmark it.

### Updating

- Changing `index.html`, `app.js`, `data.js` or `style.css` → upload and
  hard-refresh the browser (**Ctrl+Shift+R**). No restart needed.
- Changing `server.js` → restart the container:
  ```bash
  sudo DOCKER_CONFIG=/tmp/.docker docker restart dnd-campaign-tracker
  ```

### Playing away from home

To reach the tracker from outside the house, install **Tailscale** (available in
the ZimaOS App Store) on the server and on each player's device, then use the
server's Tailscale address instead of its local IP.

Avoid port forwarding. The app has no login, so exposing it directly to the
internet means anyone who finds it can read and edit the campaign.

---

## Everyday use

**Adjusting HP** — the character panel and the combat tracker both edit the same
value, so either works.

**Rolling** — click an ability, skill, save, or weapon on a sheet to roll it.
Rolls appear in the shared history, so the table sees them.

**Rests** — open the character, then Short Rest or Long Rest in the
Limited-Use Resources card. A long rest asks for confirmation, restores HP and
all spell slots, refills every resource except those tagged *Manual*, and syncs
the combat tracker.

**Levelling up** — in **Edit Specs**, change the level, the ability scores and
the proficiency bonus. Every modifier, save, skill and attack bonus recomputes.
Update HP maximum and spell slots by hand.

**Starting a new campaign** — use the campaign selector and Campaign Settings to
add one, then add characters. Nothing is hardcoded to Phandelver.

---

## DM Notes and privacy

The shared campaign state is sent to every connected browser several times a
minute, so **anything stored in it is readable by any player**. DM notes are
therefore kept in a separate file with their own PIN-gated API.

- Notes live in `data/dm_notes.json`, never in `campaign_state.json`.
- The server only returns them in response to a request carrying the correct PIN.
- The file is blocked from being fetched directly over HTTP.
- The PIN is stored scrypt-hashed with a random salt.
- Five failed attempts triggers a 30-second lockout.
- Navigating to another tab saves and re-locks automatically.

This protects against players poking around the app. It does not protect against
someone with a login on the server itself, who can read the file directly.

**There is no PIN recovery.** If it is forgotten, delete `data/dm_notes.json`
and set a new one — the notes are lost with it.

---

## Backups and recovery

Every save writes to a temporary file and then renames it, so an interrupted
write can never leave a half-written campaign. Before each save the previous
version is copied to `data/campaign_state.backup-<timestamp>.json`, and the
newest 30 are kept.

To restore one:

```bash
sudo DOCKER_CONFIG=/tmp/.docker docker exec dnd-campaign-tracker sh -c \
  'ls -t /app/data/campaign_state.backup-*.json | head -5'

sudo DOCKER_CONFIG=/tmp/.docker docker exec dnd-campaign-tracker sh -c \
  'cp /app/data/campaign_state.backup-<NAME>.json /app/data/campaign_state.json'
```

The sidebar's **Export Campaign** button downloads the whole campaign as JSON;
**Import Campaign** loads one back. Worth doing every few sessions.

---

## Data model

`campaign_state.json` holds:

```jsonc
{
  "campaigns": [{
    "id": "sample-campaign",
    "name": "Sample Campaign",
    "mapImage": "",
    "characters": {
      "hero1": {
        "name": "Sample Hero", "player": "Player One",
        "class": "Fighter", "subclass": "",
        "species": "Human", "background": "Soldier", "level": 1,
        "hp": { "current": 12, "max": 12, "temp": 0 },
        "ac": 16, "speed": "30 ft", "passivePerception": 12,
        "initiative": "+1", "proficiencyBonus": "+2",
        "abilities": { "STR": { "score": 15, "mod": "+2" } },
        "saveProfs": ["STR", "CON"],
        "skillProfs": { "athletics": "prof" },
        "skillMisc": {},
        "weapons": [{ "name": "Longsword", "ability": "STR",
                      "bonus": "+4", "damage": "1d8+2 slashing" }],
        "resources": [],
        "coins": { "pp": 0, "gp": 10, "ep": 0, "sp": 0, "cp": 0 },
        "playerNotes": "",
        "playerPassphrase": ""
      }
    },
    "sessionLogs": [], "mapMarkers": [], "partyPosition": {}
  }],
  "combatants": [], "rollHistory": [], "combatRound": 1
}
```

Key points:

- `saveProfs`, `skillProfs` and each weapon's `ability` are **stored, not
  inferred**. Derived totals are always recomputed from these, so repeated
  recalculation and levelling stay correct.
- `skillMisc` maps a skill to an extra ability modifier, for features like the
  Druid's Primal Order (Magician) adding Wisdom to Arcana and Nature.
- `resources[].reset` is `"short"`, `"long"` or `"manual"`.
- Characters are keyed by short name; `name` holds the display name.

Anything missing from an older save is filled in automatically on load.

---

## Troubleshooting

**Changes don't appear** — hard-refresh (**Ctrl+Shift+R**). A normal refresh can
serve a cached `app.js`.

**`docker compose up` says the container name is already in use** — the
container was created outside compose, through the ZimaOS UI. Use
`docker restart dnd-campaign-tracker`, or stop and remove the container first if
you want compose to manage it.

**Permission denied talking to Docker** — prefix commands with
`sudo DOCKER_CONFIG=/tmp/.docker`.

**Campaign looks empty after a change** — check the volume mapping. If a named
volume replaces the bind mount, the app reads a different, empty data directory.
Confirm with:

```bash
sudo DOCKER_CONFIG=/tmp/.docker docker inspect dnd-campaign-tracker \
  --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

**Edits keep reverting** — two people saved at once. See below.

---

## Known issues

**Last write wins.** Every client posts the entire campaign state, with no
revision check. If two people edit at the same moment, the second save
overwrites the first. Polling defers while a field is focused, which reduces but
does not eliminate it. In practice, have the DM drive combat and HP while
players edit their own sheets.

**No login.** Anyone who can reach the address can edit the campaign. Fine on a
home network; do not expose it to the internet.

**No party overview.** Character sheets show one character at a time; there is no
all-four HP view for running combat.

**HP maximum and spell slots don't scale on level-up.** The modifiers recompute
automatically; these two still need editing by hand.

---

## Changelog

**Batch 3 — DM Notes & Coins**
- PIN-protected DM notes, stored server-side, kept out of the shared state
- Coin purse per character with automatic gold total

**Batch 2 — Resources & Rests**
- Limited-use resource counters with per-resource refill rules
- Short Rest and Long Rest, including Warlock pact slots on a short rest

**Batch 1 — Correctness**
- Skill and save proficiencies are now stored rather than reverse-engineered
  from displayed values, which had silently discarded a proficiency and would
  have produced wrong numbers on level-up
- Saving throws use a full 13-class table; previously only four classes were
  recognised and every other class silently got none
- Weapons store which ability they use, instead of guessing from the name and
  notes — which had keyed Eldritch Blast to Dexterity rather than Charisma

**Hardening**
- Fixed a directory-traversal hole that let requests read files outside the
  application folder
- Saves are now atomic, so an interrupted write cannot corrupt the campaign
- Rolling backups, capped at 30
- Saves containing no campaigns are rejected rather than blanking the file

**Data repair**
- Corrected character stats that shipped as placeholder values in the seed data
  (impossible HP, `"CLASS"` and `"SPECIES"` placeholders, ability scores of 123)
- Populated the weapon lists, which were empty and left the dice roller unable
  to roll attacks
