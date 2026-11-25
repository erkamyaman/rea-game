// Records the ORIGINAL "paddles" page (originals/paddles, MIT) into replayable cases.
// The page runs unmodified in headless Chrome (driver.mjs). A case is the seeded random numbers it drew
// (tape), the inputs fed to it ({dt, keys, late?, answer?} per step) and the state it was in (one object per
// step, the first being the state right after load). Inputs come from scripted players and bots that look
// only at the previous step's state, the way a person looks at the screen, so they react to the game. The
// bots keep their OWN copy of the court's size: if it were wrong they would only play badly; every number in
// a trace comes from the original.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "../../lib/rng.mjs";
import { openOriginal, T0 } from "./driver.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DT = 1000 / 60; // 16.666666666666668
const DTS = [8, DT, 20, 33, 50, 100];

// ---- the court, as the bots know it (640 x 480, walls 12 px, paddles 12 x 60, ball radius 5)
const TOP = 17, BOTTOM = 463, LEFT_X = 17, RIGHT_X = 623, PADDLE_H = 60;
const KEYS = { left: ["q", "a"], right: ["p", "l"] }; // [up, down]

const pick = (r, a) => a[Math.floor(r() * a.length)];
const dtOf = (r, dt, dtMix) => (dtMix ? pick(r, DTS) : dt);
const press = (k) => ["+" + k, "-" + k];

// where the ball will cross x, bouncing off the top and bottom walls (no acceleration, no spin)
function landing(b, x) {
  const y = b.y + (b.dy / b.dx) * (x - b.x);
  const w = BOTTOM - TOP;
  let u = (((y - TOP) % (2 * w)) + 2 * w) % (2 * w);
  if (u > w) u = 2 * w - u;
  return TOP + u;
}

// the key events that turn the held direction of one paddle (from the state) into `want` (-1 up, 0, 1 down)
function steer(p, side, want) {
  const [up, down] = KEYS[side];
  const keys = [];
  if (p.up && want !== -1) keys.push("-" + up);
  if (p.down && want !== 1) keys.push("-" + down);
  if (want === -1 && !p.up) keys.push("+" + up);
  if (want === 1 && !p.down) keys.push("+" + down);
  return keys;
}

// a human player of one side: meets the ball where it will arrive, aiming a random part of the paddle;
// `spin` of the time it keeps moving as the ball arrives (the original turns that into spin)
function human(side, { r, miss = 0, spread = 0.6, deadzone = 4, spin = 0 }) {
  let offset = 0, lazy = false, coming = false;
  return (obs) => {
    const p = obs[side], b = obs.ball;
    if (!obs.playing || b.dx === null) return steer(p, side, 0);
    const towards = side === "left" ? b.dx < 0 : b.dx > 0;
    if (towards && !coming) { offset = (r() * 2 - 1) * spread * (PADDLE_H / 2); lazy = miss && r() < miss; }
    coming = towards;
    if (lazy) return steer(p, side, 0);
    const target = (towards ? landing(b, side === "left" ? LEFT_X : RIGHT_X) : 240) + offset;
    const centre = p.y + PADDLE_H / 2;
    const near = Math.abs(b.x - (side === "left" ? LEFT_X : RIGHT_X)) < 40;
    if (near && spin && r() < spin) return steer(p, side, r() < 0.5 ? -1 : 1);
    const diff = target - centre;
    return steer(p, side, diff > deadzone ? 1 : diff < -deadzone ? -1 : 0);
  };
}

// ---- players. A player is (obs, i) -> {dt, keys, late?, answer?} | null, with obs the state after the previous step

// `mode` "0", "1" or "2" starts a game from the menu after a short wait; `sides` play the human paddles
function game({ r, frames, dt = DT, dtMix = false, mode = "1", modes = null, wait = [10, 60], sides = [], stall = 0, esc = 0, stray = 0, rounds = Infinity }) {
  let w = -1, round = 0;
  return (obs, i) => {
    if (i >= frames) return null;
    let d = dtOf(r, dt, dtMix), late = false;
    if (stall && r() < stall) { d = 40 + Math.floor(r() * 460); late = true; }
    const out = (keys) => { const inp = { dt: d, keys }; if (late) inp.late = true; if (keys.includes("-esc")) inp.answer = r() < 0.6; return inp; };
    if (!obs.playing) {
      const idle = sides.flatMap((s) => steer(obs[s.name], s.name, 0));
      if (round >= rounds) return out(idle);
      if (w < 0) w = wait[0] + Math.floor(r() * (wait[1] - wait[0] + 1));
      if (w-- > 0) return out(stray && r() < stray ? press(pick(r, ["q", "a", "p", "l", "esc"])) : idle);
      round++;
      return out(press(modes ? pick(r, modes) : mode));
    }
    w = -1;
    if (esc && r() < esc) return out(press("esc"));
    if (stray && r() < stray) return out(press(pick(r, ["0", "1", "2", "q", "a", "p", "l"]))); // start keys do nothing during a game
    return out(sides.flatMap((s) => s.player(obs)));
  };
}
// the human sides of a case: [name, options] -> {name, player}
const sidesOf = (r, list) => list.map(([name, opts]) => ({ name, player: human(name, { r, ...opts }) }));

function scripted({ r, frames, dt = DT, dtMix = false, keys }) {
  return (obs, i) => (i >= frames ? null : { dt: dtOf(r, dt, dtMix), keys: keys(i, obs, r) });
}

// ---- coverage read off a recorded trace (independent of any port)
export function analyze(trace, inputs) {
  const c = {
    steps: inputs.length, games: 0, gamesWon: 0, abandoned: 0, abandonDeclined: 0, points: 0, paddleHits: 0, wallBounces: 0,
    spinHits: 0, predictions: 0, maxBallSpeed: 0, levels: {}, modes: { 0: 0, 1: 0, 2: 0 }, lateSteps: 0, idleSteps: 0, menuMoves: 0,
  };
  for (let f = 1; f < trace.length; f++) {
    const p = trace[f - 1], s = trace[f], inp = inputs[f - 1];
    if (inp.late) c.lateSteps++;
    if (s.last === p.last) c.idleSteps++;
    if (!p.playing && s.playing) { c.games++; c.modes[(s.left.auto ? 0 : 1) + (s.right.auto ? 0 : 1)]++; }
    if (p.playing && !s.playing) { if (s.winner !== p.winner || Math.max(...s.scores) === 9) c.gamesWon++; else if (inp.answer !== false) c.abandoned++; }
    if (p.playing && inp.keys.includes("-esc") && inp.answer === false) c.abandonDeclined++;
    c.points += Math.max(0, s.scores[0] - p.scores[0]) + Math.max(0, s.scores[1] - p.scores[1]);
    if (!s.playing && (s.left.y !== p.left.y || s.right.y !== p.right.y)) c.menuMoves++;
    for (const k of ["left", "right"]) {
      if (s[k].auto && s[k].level !== null) c.levels[s[k].level] = (c.levels[s[k].level] || 0) + 1;
      if (s[k].prediction && (!p[k].prediction || s[k].prediction.since === 0 && (p[k].prediction.since !== 0 || p[k].prediction.y !== s[k].prediction.y))) c.predictions++;
    }
    if (p.playing && s.playing && p.ball.dx !== null && s.scores[0] === p.scores[0] && s.scores[1] === p.scores[1]) {
      if (Math.sign(s.ball.dx) !== Math.sign(p.ball.dx)) {
        c.paddleHits++;
        // keys as they were during this step (a person's key events come first in a step); exact when the step is one
        // frame, an estimate when a long step holds several frames
        const pad = s.ball.dx > 0 ? s.left : s.right;
        if (pad.up || pad.down) c.spinHits++;
      } else if (Math.sign(s.ball.dy) !== Math.sign(p.ball.dy)) c.wallBounces++;
      c.maxBallSpeed = Math.max(c.maxBallSpeed, Math.abs(s.ball.dx));
    }
  }
  return c;
}

export async function runCase({ seed, player }) {
  const g = await openOriginal({ seed });
  try {
    const trace = [g.initial];
    const inputs = [];
    for (let i = 0; ; i++) {
      const inp = player(trace[trace.length - 1], i);
      if (!inp) break;
      const st = await g.step(inp);
      inputs.push(inp);
      trace.push(st);
    }
    return { tape: await g.tape(), inputs, trace };
  } finally { await g.close(); }
}

export function buildCases() {
  const R = (s) => mulberry32(s * 7919 + 17);
  const cases = [];
  const add = (name, seed, make) => cases.push({ name, seed, make: () => make(R(seed)) });
  const H = (r, list) => sidesOf(r, list);
  const all = ["q", "a", "p", "l"];
  // the menu: nothing, and both paddles moved by hand (they move in the menu too)
  add("idle-menu", 1, (r) => scripted({ r, frames: 600, keys: () => [] }));
  add("menu-paddles", 2, (r) => scripted({ r, frames: 1500, dtMix: true, keys: (i, o, rr) => (rr() < 0.15 ? [(rr() < 0.5 ? "+" : "-") + pick(rr, all)] : []) }));
  add("menu-keys-esc", 3, (r) => game({ r, frames: 1200, mode: "0", rounds: 0, stray: 0.2 }));
  // the computer against itself: whole games, at 60 Hz, mixed frame times, long frames and late steps
  add("demo-60fps", 4, (r) => game({ r, frames: 30000, mode: "0", rounds: 1 }));
  add("demo-mixed-dt", 5, (r) => game({ r, frames: 15000, mode: "0", dtMix: true }));
  add("demo-100ms", 6, (r) => game({ r, frames: 5000, mode: "0", dt: 100 }));
  add("demo-8ms", 7, (r) => game({ r, frames: 15000, mode: "0", dt: 8 }));
  add("demo-stalls", 8, (r) => game({ r, frames: 12000, mode: "0", stall: 0.03 }));
  // one player (left, Q and A) against the computer
  add("one-player-good", 11, (r) => game({ r, frames: 20000, mode: "1", sides: H(r, [["left", {}]]) }));
  add("one-player-sloppy", 12, (r) => game({ r, frames: 15000, mode: "1", sides: H(r, [["left", { miss: 0.35 }]]) }));
  add("one-player-spin", 13, (r) => game({ r, frames: 15000, mode: "1", sides: H(r, [["left", { spin: 0.4, spread: 0.9 }]]) }));
  add("one-player-33ms", 14, (r) => game({ r, frames: 8000, mode: "1", dt: 33, sides: H(r, [["left", { miss: 0.1 }]]) }));
  add("one-player-mixed-dt", 15, (r) => game({ r, frames: 10000, mode: "1", dtMix: true, sides: H(r, [["left", { miss: 0.15, spin: 0.2 }]]) }));
  add("one-player-stalls", 16, (r) => game({ r, frames: 8000, mode: "1", stall: 0.04, sides: H(r, [["left", { miss: 0.1 }]]) }));
  // two players (left Q/A, right P/L)
  add("two-players", 21, (r) => game({ r, frames: 15000, mode: "2", sides: H(r, [["left", { miss: 0.15 }], ["right", { miss: 0.15, spin: 0.3 }]]) }));
  add("two-players-mixed-dt", 22, (r) => game({ r, frames: 10000, mode: "2", dtMix: true, sides: H(r, [["left", { miss: 0.25, spin: 0.2 }], ["right", { miss: 0.1 }]]) }));
  // Escape: "Abandon game in progress ?" answered yes or no; keys that do nothing during a game; every mode in turn
  add("escape-and-restart", 31, (r) => game({ r, frames: 8000, modes: ["0", "1", "2"], esc: 0.004, wait: [5, 30], sides: H(r, [["left", { miss: 0.2 }]]) }));
  add("stray-keys", 32, (r) => game({ r, frames: 6000, modes: ["0", "1", "2"], stray: 0.03, dtMix: true, wait: [5, 30], sides: H(r, [["left", { miss: 0.3 }]]) }));
  add("held-keys-into-demo", 33, (r) => scripted({ r, frames: 3000, keys: (i) => (i === 5 ? ["+q", "+l"] : i === 40 ? ["+0", "-0"] : i === 900 ? ["-q", "-l", "+esc", "-esc"] : i === 960 ? ["+1", "-1", "+a"] : i === 1500 ? ["-a", "+esc", "-esc"] : i === 1600 ? ["+2", "-2"] : []) }));
  return cases;
}

export async function record({ only, log = () => {} } = {}) {
  const outDir = path.join(here, "cases");
  fs.mkdirSync(outDir, { recursive: true });
  const cases = buildCases().filter((c) => !only || only.includes(c.name));
  let frames = 0, inputs = 0;
  const total = { levels: {}, modes: {} };
  for (const c of cases) {
    const { tape, inputs: inp, trace } = await runCase({ seed: c.seed, player: c.make() });
    fs.writeFileSync(path.join(outDir, `${c.name}.json`), JSON.stringify({ game: "paddles", name: c.name, seed: c.seed, clock0: T0, tape, inputs: inp, trace }));
    const a = analyze(trace, inp);
    for (const k of Object.keys(a)) {
      if (typeof a[k] === "object") for (const [kk, v] of Object.entries(a[k])) total[k][kk] = (total[k][kk] ?? 0) + v;
      else total[k] = k.startsWith("max") ? Math.max(total[k] ?? 0, a[k]) : (total[k] ?? 0) + a[k];
    }
    frames += trace.length; inputs += inp.length;
    log(`${c.name.padEnd(22)} steps ${String(inp.length).padStart(5)} randoms ${String(tape.length).padStart(4)} games ${a.games} won ${a.gamesWon} abandoned ${a.abandoned}/${a.abandonDeclined} points ${a.points} hits ${a.paddleHits} spin ${a.spinHits}`);
  }
  return { cases: cases.length, inputs, frames, coverage: total };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await record({ log: console.log })));
