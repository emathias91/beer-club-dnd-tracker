# Maps folder (portable)

Campaign maps are **not** committed to git (copyrighted WotC art, large binaries).

## Option B — drop files here

Place map images in this directory (or the Docker bind mount `./maps`):

- `phandelver-map-exterior-player.webp`
- any `.webp` / `.png` / `.jpg` / `.gif` / `.svg`

They are served at:

```text
/maps/<filename>
```

Campaign `mapImage` can be:

- `/maps/phandelver-map-exterior-player.webp` (preferred)
- bare `phandelver-map-exterior-player.webp` (app resolves to `/maps/…`)

## Option C — upload in the app

If the map is missing, the Campaign Map panel shows **Browse for map…**.  
Upload stores the file under `DATA_DIR/maps/` and sets the campaign `mapImage` URL.

## Docker

`docker-compose.yml` mounts `./maps` read-only into the container at `/app/maps`.  
Uploaded maps still land in the durable `dnd-data` volume under `/app/data/maps`.
