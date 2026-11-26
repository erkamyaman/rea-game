---
name: rea-games
description: Reverse-engineer a game's behavior and rebuild it in another engine (web, Godot, Bevy, Unity) with proof it matches. Use when the user wants to clone, port, remake or understand how a game works, or says "rea this game". Records the original's inputs and state, writes a GAME.md spec, builds the port, and checks it frame by frame.
---

# rea-games

You rebuild a game from what it **does**, and prove it. The loop is: record the original, write the spec, build the
port, verify, fix, repeat. Never call a port done until `rea-games verify` says every case is identical.

## Before you start

1. Find out **what the original is and what licence it has**. A clean-room rebuild of behavior is fine; copying
   its art, music, names, or code is not, unless the licence allows it. Open source or permissive originals are
   the ones to start with (see `games/*/game.json` for the three that ship). If the licence is unclear, say so and
   ask before going on. Never use a trademarked name for the rebuild.
2. Check the tools: `node -v` (22+), and for a browser game Playwright and a Chromium (`PLAYWRIGHT_PATH`
   points at an install outside the repository; drivers load it with `loadPlaywright()` from `lib/playwright.mjs`).

## The loop

1. **Scaffold**: `rea-games new <game>` makes `games/<game>/` with `game.json`, `record.mjs`, `GAME.md` and a port stub.
2. **Make the original deterministic.** Three things vary between runs: time, random numbers, and input timing.
   - Replace the clock and `requestAnimationFrame` with a fake you step by hand (`dt` per step is an input).
   - Replace `Math.random` with a seeded generator and **save every value it returns** in the case as `tape`. The
     port reads those numbers back in the same order. If the original draws random numbers for things that do not
     change play (clouds, particles), give those a separate stream and say so in `GAME.md`.
   - Never edit the original. Wrap the browser, not the game.
3. **Record cases** (`rea-games record <game>`): each case is `{tape, inputs, trace}`. A trace entry is the state
   after one input or frame. Read it from the live game, or, when the state is private, from what it draws.
   Cover: every kind of enemy/obstacle/item, win, lose, restart, the edges (empty, full, maximum speed), odd frame
   times, and at least one saved state that is one step from each ending. Look at what the cases really contain.
4. **Write `GAME.md`** from the recording: constants, the order of operations inside one step, formulas, quirks
   (including bugs the original has: keep them, the port must match), and what is **not** modelled and why that
   cannot change the trace.
5. **Write the port** as pure logic: no DOM, no clock, an injected `rng`. A runner reads a case on stdin and prints
   `{trace, tapeUsed}`. Do not translate the original line by line; write from `GAME.md`, then check.
6. **Verify**: `rea-games verify <game> --port <name>`. The first difference is printed with its path
   (`trace[412].tRex.yPos: 46 != 45.5`). Fix the port, not the case. Use the number, not a guess.
7. **Break it on purpose** once (change a constant, an offset, an off-by-one) and see `verify` fail. A check that
   cannot fail proves nothing.
8. **Play it** in the engine: a web page with your own art, then Godot/Bevy/Unity ports that run the same cases.
   An engine port counts as verified only when it runs the cases through a runner; otherwise label it "not verified".

## Rules

- Traces come only from running the original. Never write a trace by hand.
- Do not loosen a comparison to get green (no rounding, no tolerance) unless `GAME.md` says why and how much.
- Report honestly: cases, inputs, what is covered, what is not, what fails.
- New game licences go in `NOTICE`.
