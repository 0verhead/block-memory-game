# Block Memory Game

A Svelte web game where each level is continuously harder. Players memorize active blocks, then either provide the number of cubes or reconstruct the exact pattern.

## Modes

- Count Mode: memorize the preview and enter the number of active blocks.
- Pattern Mode: memorize the preview and rebuild the active block positions.
- Training Mode: misses reveal the answer and let you retry instead of ending the run.

Every cleared round advances the level. Higher levels always increase the difficulty through more active blocks, larger boards as needed, shorter preview windows, or a combination of those. Outside Training Mode, a wrong answer ends the run and the next start begins again at level 1.

PGlite persists run and round history locally in IndexedDB, so the game can show best scores and training history without a backend.

## Stack

- Svelte 5
- TypeScript
- Vite
- PGlite persisted to IndexedDB
- Vitest
- Playwright
- GitHub Pages

## Run

```sh
npm install
npm run dev
```

Then visit the local URL printed by Vite.

## Test

```sh
npm test
```

## Deploy

The GitHub Actions workflow in `.github/workflows/pages.yml` deploys `dist/` to GitHub Pages on every push to `main`.
