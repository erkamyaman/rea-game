# Contributing to rea-games

The most useful contribution is **a new game that passes its own recording**, or **a new engine port of an existing one**.

## Add a game

Work in this order. Each step names the file you touch and the command to run. The skill is the whole workflow: read `skills/rea-games/SKILL.md` first, and write the behaviour spec in the `GAME.md` format (see `games/2048/GAME.md` for a shipped example).

1. Open (or pick up) the request issue, created from `.github/ISSUE_TEMPLATE/new-game.md`; it already carries the `game` label. Say which licence the original is under in the issue first. Pick a game whose source you may run and redistribute (MIT, BSD, Apache, public domain). No commercial games, no trademarked names, no art or sound from the original.
2. Scaffold it: `node bin/rea-games.mjs new <game>`. This creates `games/<game>/game.json`, `games/<game>/record.mjs`, `games/<game>/GAME.md`, `games/<game>/ports/web/run.mjs`, `games/<game>/ports/web/index.html`, and `games/<game>/cases/`.
3. Vendor the original unmodified under `originals/<game>` with its licence, and add a line to `NOTICE`.
4. Fill in `games/<game>/game.json` (see `game.json` port keys below). Its `original` entry records the source repo, licence and path; its `record` entry records how to record it.
5. Record it (`record.mjs`), write `GAME.md`, write the port, and make `node bin/rea-games.mjs verify <game>` print every case identical.
6. Break the port on purpose in at least three ways and show `verify` fails each time (put the numbers in the PR).
7. `node bin/rea-games.mjs pack <game>` before committing; cases are stored gzipped.
8. Make the side-by-side GIF: copy `scripts/demo-blocks.mjs` to `scripts/demo-<game>.mjs`, adapt it to the new game, and run `node scripts/demo-<game>.mjs`. It renders the original next to the rebuild and writes `docs/assets/<game>.gif` (composed by `scripts/compose.py`).
9. Bundle the play page: `node scripts/bundle.mjs` produces `docs/play/<game>.html` from the port's `play` page. Run `node scripts/bundle.mjs --check` to confirm nothing is stale.
10. Add a card to `docs/index.html`: copy a shipped `<a class="game" ...>` card. It links to `play/<game>.html`, shows `assets/<game>.gif` with alt text, and carries the title, the `verify` numbers (`.proof`), the original repo and licence (`.orig`), and a "Play the rebuild" link (`.play`).
11. Update `README.md`: add a row to "Play the rebuilds" (with the Play link to `https://erkamyaman.github.io/rea-games/play/<game>.html`), a row to "Engines" if the game adds a port, bump the `games-N` badge to the new count of directories under `games/`, and refresh the sample `verify all` output if it lists games.
12. Add the game's `verify` numbers to `docs/STATUS.md`: a row in the Verified table, or a per-game section like the one Blocks has where the table does not fit.

### `game.json` port keys

Each entry under `ports` is keyed by engine name. `cmd` is the command `verify` runs (stdin: one case, stdout: `{trace, tapeUsed}`); `play` is the web page `bundle` turns into `docs/play/<game>.html`; `build` is run first by `lib/verify.mjs` when present, before any case is replayed.

A Node port needs no build step (`games/2048/game.json`, `web`):

```json
"web": {
  "cmd": ["node", "ports/web/run.mjs"],
  "play": "ports/web/index.html"
}
```

A port that needs a build step (`games/2048/game.json`, `bevy`):

```json
"bevy": {
  "build": ["cargo", "build", "--release", "--quiet", "--manifest-path", "ports/bevy/Cargo.toml", "-p", "game2048-runner"],
  "cmd": ["ports/bevy/target/release/game2048-runner"]
}
```

### Before you open the PR

- `npm test` and `node bin/rea-games.mjs verify all` pass; report numbers as `verify` printed them.
- `node scripts/bundle.mjs --check` is clean, so the play page is built.
- The GIF in `docs/assets/<game>.gif` matches the new landing card.
- The landing card in `docs/index.html`, the README numbers (tables, badge, sample output) and the `docs/STATUS.md` row are all updated.

## Add an engine port

A port is any program that reads a case on stdin and prints `{trace, tapeUsed}` (see `games/2048/ports/godot/runner.gd` and `games/2048/ports/bevy/runner/src/main.rs`). Add it to the game's `game.json`. It counts as verified only when `verify` passes it.

## Rules

- Recording a browser game needs Playwright with Chromium. If it is installed outside the repository, set `PLAYWRIGHT_PATH` to that install's `playwright` folder; drivers load it through `lib/playwright.mjs`.
- `npm test` runs the unit tests in `test/` (Node only, a few seconds); run it after changing anything in `lib/`.
- `npm run verify` replays every case through every port.
- After changing a web port, run `node scripts/bundle.mjs` to rebuild the play pages in `docs/play/`.
  `node scripts/bundle.mjs --check` says which pages are stale without writing them; CI runs it after `npm test`.
- Never edit a recording by hand, and never loosen a comparison to get green.
- Report numbers as `verify` printed them, including what is not covered.
- Add a mistake worth not repeating to `docs/pitfalls.md` in the same change.
