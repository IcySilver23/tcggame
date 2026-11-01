# Project conventions

## The in-game changelog ships with every update

`CHANGELOG.json` is what the **✨ What's New** panel reads (`/api/changelog` →
`src/views/WhatsNew.tsx`). Every player-visible change must land there in the
same piece of work that made the change — never leave it for later, and never
ship a build whose changelog is older than the code.

For each update:

1. **Add one entry at the top of `entries`** (newest first — the panel walks the
   list in order and marks the newest as "you are here").
2. **Bump the version** in `package.json` (patch for fixes, minor for new
   systems) so the entry actually badges as unseen. `APP_VERSION` is read from
   `package.json`; `changelog:seenVersion` is per-save, so a version bump is what
   makes the badge light up.
3. **Fill in the schema** exactly: `version`, `date` (`YYYY-MM-DD`), `title`
   (short, evocative — "Real prices, real packs"), and `features` (an array of
   one-string entries).
4. **Write features for the player, not the diff.** Name the screen or system,
   say what was wrong before when it helps, and give the concrete numbers or
   behaviour they will notice. Existing entries are the house style: a full
   sentence or three each, no file names, no commit talk.
5. **Say so honestly.** If part of a change is a simplification (pack odds
   scaled to the game's ten-card packs, a researched price that is a range being
   treated as a point, unknown data left alone), the entry should admit it
   rather than implying perfect fidelity.

Run `node ./node_modules/typescript/bin/tsc --noEmit` and `npm run build` before
calling the update done; the changelog is bundled into the server at build time.

## Other standing conventions

- Before/after screenshots for screen overhauls go in `screenshots/`.
- Saves live in `data/tcglife.db`; restore any test state you perturb.
- One-off patch/verification scripts belong in `tmp/`, not in `server/`.
