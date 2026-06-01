# record-tour

Playwright-driven recording of `wow_*` guest-tour scenes on `tryepisteme.com`.
Output is raw `.webm` in `.tmp/tour-record/`; `encode.sh` re-encodes to
shipped assets under `apps/km/public/tour/`.

## Prereqs

- `pnpm install` (installs `playwright` as devDep)
- `pnpm exec playwright install chromium`
- `ffmpeg` on PATH (for encode)
- env vars: `TOUR_RECORD_EMAIL`, `TOUR_RECORD_PASSWORD` (use the seeded
  test account, e.g. `test@mohid.de`)
- optional: `TOUR_RECORD_BASE_URL` (default `https://tryepisteme.com`)

## Run one scene

```sh
cd apps/km
TOUR_RECORD_EMAIL=… TOUR_RECORD_PASSWORD=… pnpm record-tour refs_fill
```

Prints the raw video path on stdout.

## Record + encode in one shot

From monorepo root:

```sh
cd apps/km/scripts/record-tour
./record-and-encode.sh refs_fill
```

Writes `apps/km/public/tour/wow_refs_fill.webm` + `.poster.jpg`.

## Scenes

`refs_fill`, `reader_highlight`, `deepread`, `extract`.
