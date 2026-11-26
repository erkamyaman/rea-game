// Runs the ORIGINAL "bricks" page (originals/bricks, MIT, vendored unmodified) in headless Chrome and
// reads its state from the live game object (Game.current). Only its inputs are replaced: a fake clock
// (Date, performance.now, setTimeout, setInterval and their clear functions), a seeded Math.random whose
// every value goes to a tape, and window.confirm (the "Abandon game?" question), which answers what the
// case says. The page's sound library (sound/soundmanager2-*.js) keeps the real timers: it never touches
// the game's state, and its polling would only slow the fake clock down.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPlaywright } from "../../lib/playwright.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ORIGINAL = path.join(here, "../../originals/bricks/index.html");
export const T0 = 1000000; // the fake clock's start, in ms (the port uses the same)
export const KEYCODES = { left: 37, right: 39, a: 65, d: 68, space: 32, enter: 13, esc: 27, up: 38, down: 40 };

// runs in the page before any of its scripts
function install({ seed, T0, KEYCODES }) {
  let t = T0;
  const tape = [];
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    const v = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    tape.push(v);
    return v;
  };
  // the page reads the time with `new Date().getTime()`
  const RealDate = Date;
  const FakeDate = function (...args) { return args.length ? new RealDate(...args) : new RealDate(Math.floor(t)); };
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => Math.floor(t);
  FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
  window.Date = FakeDate;
  performance.now = () => t - T0;

  // timers: one queue, ordered by due time, then by the order they were (re)scheduled
  const real = { setTimeout: window.setTimeout.bind(window), setInterval: window.setInterval.bind(window), clearTimeout: window.clearTimeout.bind(window), clearInterval: window.clearInterval.bind(window) };
  const fromSoundLibrary = () => /soundmanager2/.test(new Error().stack || "");
  const timers = new Map();
  let nextId = 1, seq = 0;
  const add = (fn, d, args, repeat) => {
    const id = nextId++;
    const delay = Number(d) || 0;
    timers.set(id, { id, due: t + delay, fn, args, every: repeat ? delay : null, seq: seq++ });
    return id;
  };
  // the sound library's timers get negative ids, so the clear functions can tell them apart
  window.setTimeout = (fn, d, ...args) => (fromSoundLibrary() ? -real.setTimeout(fn, d, ...args) : add(fn, d, args, false));
  window.setInterval = (fn, d, ...args) => (fromSoundLibrary() ? -real.setInterval(fn, d, ...args) : add(fn, d, args, true));
  window.clearTimeout = window.clearInterval = (id) => { if (id < 0) { real.clearTimeout(-id); real.clearInterval(-id); } else timers.delete(id); };

  // move the clock by ms. On time: each timer fires at its due time (the clock jumps there first), in due order,
  // and an interval comes due again `every` ms after it fired. Late (the page was busy): the clock jumps to the end
  // first and every timer that came due fires once, in due order.
  function advance(ms, late) {
    const target = t + ms;
    if (late) t = target;
    for (;;) {
      let best = null;
      for (const x of timers.values()) if (x.due <= target && (!best || x.due < best.due || (x.due === best.due && x.seq < best.seq))) best = x;
      if (!best) break;
      if (best.due > t) t = best.due;
      if (best.every === null) timers.delete(best.id); else { best.due = t + best.every; best.seq = seq++; }
      best.fn(...best.args);
    }
    t = target;
  }

  let answer = true;
  window.confirm = () => answer;

  window.__bricks = {
    ready: () => typeof window.soundManager !== "undefined" && !!window.Game && !!Game.current,
    state() {
      const g = Game.current, b = g.ball, p = g.paddle, s = g.score;
      return {
        state: g.current, level: g.level,
        score: s.score, vscore: s.vscore, highscore: s.highscore, lives: s.lives,
        paddle: { x: p.x, left: p.dleft, right: p.dright },
        ball: { x: b.x, y: b.y, dx: b.dx, dy: b.dy, speed: b.speed, moving: b.moving, countdown: b.countdown ?? null, label: b.label ? b.label.text : null },
        bricks: g.court.bricks.map((k) => (k.hit ? "x" : "o")).join(""),
        last: g.runner.lastFrame,
      };
    },
    // one input: the key events in order (`+key` is keydown, `-key` keyup), then the clock moves by dt
    step({ dt, keys = [], late = false, answer: ans = true }) {
      answer = ans;
      for (const k of keys) {
        const type = k[0] === "+" ? "keydown" : "keyup";
        document.dispatchEvent(new KeyboardEvent(type, { keyCode: KEYCODES[k.slice(1)], bubbles: true, cancelable: true }));
      }
      advance(dt, late);
    },
    // the bricks of every level as the original lays them out: [x1, x2, y, score] in court chunks
    levels() {
      const g = Game.current;
      const out = [];
      for (let n = 0; n < Breakout.Levels.length; n++) {
        g.court.reset(n);
        out.push(g.court.bricks.map((k) => [k.pos.x1, k.pos.x2, k.pos.y, k.score]));
      }
      return out;
    },
    tape: () => tape.slice(),
  };
}

async function launch(headless) {
  const { chromium } = loadPlaywright();
  try { return await chromium.launch({ headless }); }
  catch { return await chromium.launch({ headless, channel: "chrome" }); }
}

async function load(browser, seed) {
  // a new context per page: empty localStorage, so no level or high score leaks from one case to the next
  const context = await browser.newContext({ viewport: { width: 700, height: 700 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(install, { seed, T0, KEYCODES });
  await page.goto(pathToFileURL(ORIGINAL).href, { waitUntil: "load" });
  // playSound reads the global soundManager, so the game must not run before the sound library has loaded
  await page.waitForFunction(() => window.__bricks.ready(), null, { timeout: 10000 });
  return { page, errors };
}

// the brick layout of each level, read from the original (a throwaway page, so the recording page is untouched)
export async function readLevels() {
  const browser = await launch(true);
  try {
    const { page } = await load(browser, 1);
    return await page.evaluate(() => window.__bricks.levels());
  } finally { await browser.close(); }
}

export async function openOriginal({ seed = 1, headless = true } = {}) {
  const browser = await launch(headless);
  let page, errors, initial;
  const check = () => { if (errors.length) throw new Error("the original threw: " + errors.join(" | ")); };
  try {
    ({ page, errors } = await load(browser, seed));
    check();
    initial = await page.evaluate(() => window.__bricks.state()); // the state the page's start-up leaves
  } catch (e) { await browser.close(); throw e; }
  return {
    page,
    initial,
    step: async (inp) => { const s = await page.evaluate((i) => { window.__bricks.step(i); return window.__bricks.state(); }, inp); check(); return s; },
    shot: (file) => page.screenshot({ path: file }),
    tape: () => page.evaluate(() => window.__bricks.tape()),
    close: () => browser.close(),
  };
}
