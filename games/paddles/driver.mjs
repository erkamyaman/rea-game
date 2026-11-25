// Runs the ORIGINAL "paddles" page (originals/paddles, MIT, vendored unmodified) in headless Chrome and
// reads its state from the live game object. Only its inputs are replaced: a fake clock (Date,
// performance.now, setTimeout, setInterval and their clear functions), a seeded Math.random whose every
// value goes to a tape, and window.confirm (the "Abandon game in progress ?" question), which answers what
// the case says. The page keeps its game object in a local variable, so the driver remembers it when the
// page creates it: Pong.initialize is wrapped to note `this`, and then runs unchanged.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ORIGINAL = path.join(here, "../../originals/paddles/index.html");
export const T0 = 1000000; // the fake clock's start, in ms (the port uses the same)
export const KEYCODES = { 0: 48, 1: 49, 2: 50, esc: 27, q: 81, a: 65, p: 80, l: 76 };

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const tries = ["playwright", process.env.PLAYWRIGHT_PATH, "/opt/node22/lib/node_modules/playwright", "/opt/node-tools/node_modules/playwright"].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch {} }
  throw new Error("playwright not found; set PLAYWRIGHT_PATH");
}

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
  const timers = new Map();
  let nextId = 1, seq = 0;
  const add = (fn, d, args, repeat) => {
    const id = nextId++;
    const delay = Number(d) || 0;
    timers.set(id, { id, due: t + delay, fn, args, every: repeat ? delay : null, seq: seq++ });
    return id;
  };
  window.setTimeout = (fn, d, ...args) => add(fn, d, args, false);
  window.setInterval = (fn, d, ...args) => add(fn, d, args, true);
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };

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

  // remember the game object when the page makes it (pong.js assigns the global `Pong` once)
  let PongDef;
  Object.defineProperty(window, "Pong", {
    configurable: true,
    get: () => PongDef,
    set: (v) => {
      const init = v.initialize;
      v.initialize = function (...args) { window.__game = this; return init.apply(this, args); };
      PongDef = v;
    },
  });

  const paddle = (p) => ({
    y: p.y, up: p.up, down: p.down, auto: !!p.auto,
    level: p.level ? Pong.Levels.indexOf(p.level) : null,
    prediction: p.prediction ? { x: p.prediction.x, y: p.prediction.y, dx: p.prediction.dx, dy: p.prediction.dy, since: p.prediction.since, exactY: p.prediction.exactY } : null,
  });
  window.__paddles = {
    // ready once the images have loaded and the frame loop has started
    ready: () => !!(window.__game && window.__game.runner && window.__game.runner.timer),
    state() {
      const g = window.__game, b = g.ball;
      return {
        playing: g.playing, scores: g.scores.slice(), winner: g.menu.winner ?? null,
        left: paddle(g.leftPaddle), right: paddle(g.rightPaddle),
        ball: { x: b.x ?? null, y: b.y ?? null, dx: b.dx ?? null, dy: b.dy ?? null },
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
    tape: () => tape.slice(),
  };
}

export async function openOriginal({ seed = 1, headless = true } = {}) {
  const { chromium } = loadPlaywright();
  let browser;
  try { browser = await chromium.launch({ headless }); }
  catch { browser = await chromium.launch({ headless, channel: "chrome" }); }
  let page, initial;
  const errors = [];
  const check = () => { if (errors.length) throw new Error("the original threw: " + errors.join(" | ")); };
  try {
    // a new context per case: nothing is kept between pages
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(install, { seed, T0, KEYCODES });
    await page.goto(pathToFileURL(ORIGINAL).href, { waitUntil: "load" });
    await page.waitForFunction(() => window.__paddles.ready(), null, { timeout: 10000 });
    check();
    initial = await page.evaluate(() => window.__paddles.state()); // the state the page's start-up leaves
  } catch (e) { await browser.close(); throw e; }
  return {
    page,
    initial,
    step: async (inp) => { const s = await page.evaluate((i) => { window.__paddles.step(i); return window.__paddles.state(); }, inp); check(); return s; },
    shot: (file) => page.screenshot({ path: file }),
    tape: () => page.evaluate(() => window.__paddles.tape()),
    close: () => browser.close(),
  };
}
