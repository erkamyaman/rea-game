// Records the ORIGINAL "bricks" page (originals/bricks, MIT) into replayable cases.
// The page runs unmodified in headless Chrome (driver.mjs). A case is the seeded random numbers it drew
// (tape), the brick layout of every level as the original builds it (levels), the inputs fed to it
// ({dt, keys, late?, answer?} per step) and the state it was in (one object per step, the first being the
// state right after load). Inputs come from scripted players and bots that look only at the previous
// step's state, the way a person looks at the screen, so they react to the game. The bots keep their OWN
// copy of the court's size: if it were wrong they would only play badly; every number in a trace comes
// from the original.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "../../lib/rng.mjs";
import { openOriginal, readLevels, T0 } from "./driver.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DT = 1000 / 60; // 16.666666666666668
const DTS = [8, DT, 20, 33, 50, 100];

// ---- the court, as the bots know it (640 x 480 canvas, 14 px chunks)
const LEFT = 110, RIGHT = 530, TOP = 65, PADDLE_W = 84, PADDLE_TOP = 401, R = 4.2;

const pick = (r, a) => a[Math.floor(r() * a.length)];
const dtOf = (r, dt, dtMix) => (dtMix ? pick(r, DTS) : dt);
const press = (k) => ["+" + k, "-" + k];

// where a falling ball will cross the paddle's top, bouncing off the side walls (bricks ignored)
function landing(b) {
  if (!b.moving || b.dy < 1e-6) return b.x;
  const x = b.x + (b.dx / b.dy) * (PADDLE_TOP - R - b.y);
  const lo = LEFT + R, w = RIGHT - R - lo;
  let u = (((x - lo) % (2 * w)) + 2 * w) % (2 * w);
  if (u > w) u = 2 * w - u;
  return lo + u;
}

// the key events that turn the held direction (from the state: paddle.left / paddle.right) into `want`
function steer(obs, want, alias) {
  const L = alias ? "a" : "left", Rt = alias ? "d" : "right";
  const keys = [];
  if (obs.paddle.left && want !== -1) keys.push("-" + L);
  if (obs.paddle.right && want !== 1) keys.push("-" + Rt);
  if (want === -1 && !obs.paddle.left) keys.push("+" + L);
  if (want === 1 && !obs.paddle.right) keys.push("+" + Rt);
  return keys;
}

// ---- players. A player is (obs, i) -> {dt, keys, late?, answer?} | null, with obs the state after the previous step

// wraps a play style with "in the menu: wait, walk to the wanted level with up/down, then press Space (or Enter)"
function withMenu(inner, { r, wait = [10, 40], level = null, enter = 0, rounds = Infinity, stray = 0, idle = null }) {
  let w = -1, round = 0;
  return (obs, i) => {
    const a = inner(obs && obs.state === "game" ? obs : null, i);
    if (a === null) return null;
    if (obs.state === "game") { w = -1; return a; }
    const rest = (keys) => ({ ...a, keys });
    const waiting = () => rest(idle ? idle(i, obs, r) : stray && r() < stray ? press(pick(r, ["left", "right", "up", "down", "esc", "a", "d"])) : []);
    if (round >= rounds) return waiting();
    if (w < 0) w = wait[0] + Math.floor(r() * (wait[1] - wait[0] + 1));
    if (w-- > 0) return waiting();
    const want = typeof level === "function" ? level(round) : level;
    if (want !== null && obs.level !== want) return rest(press(obs.level < want ? "up" : "down"));
    round++;
    return rest(press(enter && r() < enter ? "enter" : "space"));
  };
}

function scripted({ r, frames, dt = DT, dtMix = false, keys, menu = {} }) {
  const inner = (obs, i) => (i >= frames ? null : { dt: dtOf(r, dt, dtMix), keys: obs ? keys(i, obs, r) : [] });
  return withMenu(inner, { r, ...menu });
}

// the part of the paddle (-1 left end .. 1 right end) that sends a ball landing at x towards (bx, by): leaving the
// paddle, the ball's direction is (part, -dy) before it is normalised; a target behind a side wall is mirrored
function aim(x, dy, bx, by) {
  let best = null;
  for (const tx of [bx, 2 * (LEFT + R) - bx, 2 * (RIGHT - R) - bx]) {
    const part = (dy * (tx - x)) / (PADDLE_TOP - R - by);
    if (best === null || Math.abs(part) < Math.abs(best)) best = part;
  }
  return Math.max(-0.95, Math.min(0.95, best));
}

// follows the ball to where it will land; with `levels` it aims at a brick that is left (`seek` of the time),
// otherwise at a random part of the paddle, so the bounces vary
function bot({ r, levels, frames, dt = DT, dtMix = false, spread = 0.7, seek = 0.6, deadzone = 3, miss = 0, launchNow = 0, alias = 0, stall = 0, esc = 0, menu = {} }) {
  let offset = 0, wasDown = false, lazy = false;
  const inner = (obs, i) => {
    if (i >= frames) return null;
    let d = dtOf(r, dt, dtMix);
    let late = false;
    if (stall && r() < stall) { d = 40 + Math.floor(r() * 460); late = true; }
    if (!obs) return late ? { dt: d, keys: [], late } : { dt: d, keys: [] };
    const b = obs.ball;
    if (b.moving && b.dy > 0 && !wasDown) {
      offset = (r() * 2 - 1) * spread * (PADDLE_W / 2);
      lazy = miss && r() < miss;
      const left = levels[obs.level].filter((k, n) => obs.bricks[n] === "o");
      if (left.length && r() < seek) {
        const [x1, x2, y] = pick(r, left);
        offset = aim(landing(b), b.dy, LEFT + ((x1 + x2 + 1) / 2) * 14, TOP + (y + 0.5) * 14) * (PADDLE_W / 2);
      }
    }
    wasDown = b.moving && b.dy > 0;
    let keys;
    if (esc && r() < esc) keys = press("esc");
    else if (!b.moving && launchNow && r() < launchNow) keys = press(r() < 0.5 ? "space" : "enter");
    else {
      // falling: go to where it lands; rising: stay under it (a brick can send it back at any time)
      const target = (b.moving && b.dy > 0 ? landing(b) : b.moving ? b.x : (LEFT + RIGHT) / 2) - offset;
      const diff = target - (obs.paddle.x + PADDLE_W / 2);
      const want = lazy ? 0 : diff > deadzone ? 1 : diff < -deadzone ? -1 : 0;
      keys = steer(obs, want, alias && r() < alias);
    }
    const inp = { dt: d, keys };
    if (late) inp.late = true;
    if (keys.includes("-esc")) inp.answer = r() < 0.6;
    return inp;
  };
  return withMenu(inner, { r, wait: [8, 40], ...menu });
}

// ---- coverage read off a recorded trace (independent of any port)
export function analyze(trace, inputs) {
  const c = {
    steps: inputs.length, starts: 0, livesLost: 0, gamesLost: 0, abandoned: 0, abandonDeclined: 0, levelsWon: 0, levelWrap: 0,
    bricksHit: 0, maxBricksInStep: 0, paddleBounces: 0, launchNow: 0, countdownLaunches: 0, menuLevelChanges: 0,
    menuPaddleMoves: 0, highscoreRaised: 0, maxLives: 0, maxSpeed: 0, maxLevel: 0, lateSteps: 0, idleSteps: 0, levels: {},
  };
  for (let f = 1; f < trace.length; f++) {
    const p = trace[f - 1], s = trace[f], inp = inputs[f - 1];
    if (inp.late) c.lateSteps++;
    if (s.last === p.last) c.idleSteps++;
    c.maxLives = Math.max(c.maxLives, s.lives); c.maxSpeed = Math.max(c.maxSpeed, s.ball.speed); c.maxLevel = Math.max(c.maxLevel, s.level);
    if (s.state === "game") c.levels[s.level] = (c.levels[s.level] || 0) + 1;
    if (s.highscore > p.highscore) c.highscoreRaised++;
    // a step that wins a level ends on the next level's layout: the bricks it hit are all that were left
    const standing = (b) => [...b].filter((x) => x === "o").length;
    const hits = p.level === s.level ? standing(p.bricks) - standing(s.bricks) : standing(p.bricks);
    if (p.state === "game" && s.state === "game" && hits > 0) { c.bricksHit += hits; c.maxBricksInStep = Math.max(c.maxBricksInStep, hits); }
    if (p.state === "menu" && s.state === "game") c.starts++;
    if (p.state === "game" && s.state === "menu") {
      if (inp.keys.includes("-esc") && inp.answer !== false) c.abandoned++; else { c.gamesLost++; c.livesLost++; }
    }
    if (p.state === "game" && inp.keys.includes("-esc") && inp.answer === false) c.abandonDeclined++;
    if (p.state === "game" && s.state === "game" && s.lives < p.lives) c.livesLost++;
    if (p.state === "game" && s.state === "game" && s.level !== p.level) { c.levelsWon++; if (s.level < p.level) c.levelWrap++; }
    if (p.state === "menu" && s.state === "menu" && s.level !== p.level) c.menuLevelChanges++;
    if (p.state === "menu" && s.paddle.x !== p.paddle.x && s.state === "menu" && p.level === s.level) c.menuPaddleMoves++;
    if (p.ball.moving && s.ball.moving && p.ball.dy > 0 && s.ball.dy < 0 && s.ball.y > 340) c.paddleBounces++;
    if (p.state === "game" && s.state === "game" && !p.ball.moving && s.ball.moving) { if (s.ball.label === null) c.launchNow++; else c.countdownLaunches++; }
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
  const add = (name, seed, make) => cases.push({ name, seed, make: (levels) => make(R(seed), levels) });
  const lr = ["left", "right", "a", "d"];
  // the menu: nothing, the paddle (and the ball on it) moving, the level keys, keys that do nothing there
  add("idle-menu", 1, (r) => scripted({ r, frames: 600, keys: () => [], menu: { rounds: 0 } }));
  add("menu-paddle", 2, (r) => scripted({ r, frames: 900, dtMix: true, keys: () => [], menu: { rounds: 0, idle: (i, o, rr) => (rr() < 0.1 ? [(rr() < 0.5 ? "+" : "-") + pick(rr, lr)] : []) } }));
  add("menu-keys", 3, (r) => scripted({ r, frames: 1200, dtMix: true, keys: () => [], menu: { wait: [300, 600], stray: 0.5, rounds: 2 } }));
  add("menu-levels-up-down", 4, (r) => scripted({ r, frames: 900, keys: () => [], menu: { level: (n) => [9, 0, 5, 3][n % 4], wait: [2, 8], rounds: 3 } }));
  // start and do nothing: the countdown, the launch on "go", the ball lost three times, the next game
  add("start-and-wait", 5, (r) => scripted({ r, frames: 4000, keys: () => [], menu: { wait: [5, 30] } }));
  add("start-and-wait-100ms", 6, (r) => scripted({ r, frames: 1500, dt: 100, keys: () => [], menu: { wait: [2, 10], enter: 0.5 } }));
  add("start-and-wait-mixed-dt", 7, (r) => scripted({ r, frames: 4000, dtMix: true, keys: () => [], menu: { wait: [2, 20] } }));
  // Space or Enter during the countdown launches at once; pressed again while the ball moves it does nothing
  add("launch-now", 8, (r) => scripted({ r, frames: 3000, dtMix: true, keys: (i, o, rr) => (rr() < 0.04 ? press(pick(rr, ["space", "enter"])) : []), menu: { wait: [2, 15], enter: 0.4 } }));
  // random keys, held and released at random
  add("random-keys-60fps", 9, (r) => scripted({ r, frames: 3000, keys: (i, o, rr) => (rr() < 0.15 ? [(rr() < 0.5 ? "+" : "-") + pick(rr, lr)] : []), menu: { wait: [2, 20] } }));
  add("random-keys-mixed-dt", 10, (r) => scripted({ r, frames: 3000, dtMix: true, keys: (i, o, rr) => (rr() < 0.2 ? [(rr() < 0.5 ? "+" : "-") + pick(rr, [...lr, "space", "up", "down"])] : []), menu: { wait: [2, 20] } }));
  add("several-keys-per-step", 11, (r) => scripted({ r, frames: 2000, dtMix: true, keys: (i, o, rr) => { const k = []; const n = Math.floor(rr() * 4); for (let j = 0; j < n; j++) k.push((rr() < 0.5 ? "+" : "-") + pick(rr, [...lr, "space", "enter", "up", "down"])); return k; }, menu: { wait: [2, 15] } }));
  add("hold-both-directions", 12, (r) => scripted({ r, frames: 1500, keys: (i) => (i % 120 === 10 ? ["+left"] : i % 120 === 40 ? ["+right"] : i % 120 === 70 ? ["-left"] : i % 120 === 100 ? ["-right"] : []), menu: { wait: [2, 10] } }));
  // bots that clear bricks, one per level (chosen in the menu), at 60 frames a second
  for (let lv = 0; lv < 10; lv++) add(`bot-level-${lv + 1}`, 20 + lv, (r, levels) => bot({ r, levels, frames: 6000, menu: { level: lv } }));
  // bots at other frame times
  add("bot-8ms", 31, (r, levels) => bot({ r, levels, frames: 6000, dt: 8 }));
  add("bot-20ms", 32, (r, levels) => bot({ r, levels, frames: 5000, dt: 20, menu: { level: 2 } }));
  add("bot-33ms", 33, (r, levels) => bot({ r, levels, frames: 4000, dt: 33, menu: { level: 4 } }));
  add("bot-50ms", 34, (r, levels) => bot({ r, levels, frames: 3000, dt: 50, menu: { level: 6 } }));
  add("bot-100ms", 35, (r, levels) => bot({ r, levels, frames: 2000, dt: 100 }));
  add("bot-mixed-dt", 36, (r, levels) => bot({ r, levels, frames: 5000, dtMix: true, alias: 0.3, menu: { level: 1 } }));
  // the page was busy: steps of 40 to 500 ms where every timer that came due fires once, at the end
  add("bot-stalls", 37, (r, levels) => bot({ r, levels, frames: 5000, stall: 0.03 }));
  add("bot-stalls-mixed-dt", 38, (r, levels) => bot({ r, levels, frames: 4000, dtMix: true, stall: 0.05, menu: { level: 3 } }));
  // bots with slips: they lose lives and games, and start again (the high score is kept)
  add("bot-sloppy", 39, (r, levels) => bot({ r, levels, frames: 8000, miss: 0.25, launchNow: 0.05 }));
  add("bot-sloppy-edges", 40, (r, levels) => bot({ r, levels, frames: 8000, miss: 0.15, spread: 1.05, deadzone: 8, menu: { level: 1 } }));
  add("bot-launch-now", 41, (r, levels) => bot({ r, levels, frames: 5000, launchNow: 0.2, miss: 0.1 }));
  // Escape: the page asks "Abandon game?"; yes ends the game, no keeps it (the loop restarts either way)
  add("bot-escape", 42, (r, levels) => bot({ r, levels, frames: 5000, esc: 0.003 }));
  add("bot-escape-mixed-dt", 43, (r, levels) => bot({ r, levels, frames: 4000, dtMix: true, esc: 0.005, menu: { level: 5 } }));
  // long runs: several levels in a row, lives up to the cap of 5, the last level wrapping to the first
  add("bot-marathon-from-1", 51, (r, levels) => bot({ r, levels, frames: 30000, spread: 0.8 }));
  add("bot-marathon-from-9", 52, (r, levels) => bot({ r, levels, frames: 30000, spread: 0.8, menu: { level: 8 } }));
  return cases;
}

export async function record({ only, log = () => {} } = {}) {
  const outDir = path.join(here, "cases");
  fs.mkdirSync(outDir, { recursive: true });
  const levels = await readLevels();
  const cases = buildCases().filter((c) => !only || only.includes(c.name));
  let frames = 0, inputs = 0;
  const total = { levels: {} };
  for (const c of cases) {
    const { tape, inputs: inp, trace } = await runCase({ seed: c.seed, player: c.make(levels) });
    fs.writeFileSync(path.join(outDir, `${c.name}.json`), JSON.stringify({ game: "bricks", name: c.name, seed: c.seed, clock0: T0, levels, tape, inputs: inp, trace }));
    const a = analyze(trace, inp);
    for (const k of Object.keys(a)) {
      if (typeof a[k] === "object") for (const [kk, v] of Object.entries(a[k])) total[k][kk] = (total[k][kk] ?? 0) + v;
      else total[k] = k.startsWith("max") ? Math.max(total[k] ?? 0, a[k]) : (total[k] ?? 0) + a[k];
    }
    frames += trace.length; inputs += inp.length;
    log(`${c.name.padEnd(24)} steps ${String(inp.length).padStart(5)} randoms ${String(tape.length).padStart(3)} bricks ${String(a.bricksHit).padStart(4)} won ${a.levelsWon} lives lost ${a.livesLost} games lost ${a.gamesLost} abandoned ${a.abandoned}/${a.abandonDeclined} level max ${a.maxLevel + 1} lives max ${a.maxLives}`);
  }
  return { cases: cases.length, inputs, frames, coverage: total };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await record({ log: console.log })));
