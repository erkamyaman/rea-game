// Drives the ORIGINAL Chrome Dino (originals/dino, unmodified) in Chromium under a fake clock.
// The page only advances when step() is called: performance.now, Date.now, requestAnimationFrame
// and cancelAnimationFrame are replaced, the CSS intro animation is switched off and its end
// event is dispatched by the driver, AudioContext is a stub, and Math.random is split in two
// seeded streams (gameplay = recorded on `tape`, visual = not recorded).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPlaywright } from "../../lib/playwright.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(path.join(here, "../../originals/dino/index.html")).href;

export const CLOCK0 = 1000; // fake performance.now() when the page is loaded (ms)
export const INTRO_MS = 400; // the CSS animation 'intro .4s ease-out' in Runner.playIntro

// Runs inside the page before any page script.
function installFakes({ gameSeed, visualSeed, clock0, introMs }) {
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  Error.stackTraceLimit = 60;
  const game = mulberry32(gameSeed);
  const visual = mulberry32(visualSeed);
  const tape = [];
  const callers = {}; // "stream: Fn < Fn" -> count, to check the split
  Math.random = function () {
    const stack = new Error().stack || "";
    const isGame = /Obstacle/.test(stack);
    const frames = stack.split("\n").slice(2, 4).map((l) => (l.trim().match(/^at (?:new )?([^ (]+)/) || [])[1] || "?");
    const key = (isGame ? "game  " : "visual") + ": " + frames.join(" < ");
    callers[key] = (callers[key] || 0) + 1;
    if (isGame) {
      const v = game();
      tape.push(v);
      return v;
    }
    return visual();
  };

  let t = clock0;
  let nextId = 1;
  let queue = []; // pending requestAnimationFrame callbacks: {id, cb}
  let running = null; // the frame being run, so a cancel can stop callbacks not yet called
  performance.now = () => t;
  Date.now = () => 1700000000000 + Math.floor(t);
  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queue = queue.filter((q) => q.id !== id);
    if (running) for (const q of running) if (q.id === id) q.cancelled = true;
  };
  // sound off: nothing decodes, so Runner.soundFx stays empty and playSound does nothing
  window.AudioContext = window.webkitAudioContext = function () {
    this.decodeAudioData = () => {};
  };
  // no CSS animation: its end event is dispatched by step() after introMs fake milliseconds
  // (the style rule itself is added by openOriginal once the document exists)

  const R = () => window.Runner.instance_;
  let introStart = null;

  function snapshot() {
    const r = R();
    const x = r.tRex;
    return {
      playing: r.playing,
      crashed: r.crashed,
      activated: r.activated,
      playingIntro: !!r.playingIntro,
      paused: r.paused,
      currentSpeed: r.currentSpeed,
      distanceRan: r.distanceRan,
      score: r.distanceMeter.getActualDistance(Math.ceil(r.distanceRan)),
      highestScore: r.highestScore,
      runningTime: r.runningTime,
      playCount: r.playCount,
      time: r.time,
      running: !!r.raqId,
      rafPending: queue.length,
      tRex: {
        xPos: x.xPos, yPos: x.yPos, jumping: x.jumping, ducking: x.ducking, speedDrop: x.speedDrop,
        jumpVelocity: x.jumpVelocity, jumpCount: x.jumpCount, status: x.status, reachedMinHeight: x.reachedMinHeight,
      },
      obstacleHistory: r.horizon.obstacleHistory.slice(),
      obstacles: r.horizon.obstacles.map((o) => ({
        type: o.typeConfig.type, xPos: o.xPos, yPos: o.yPos, size: o.size, width: o.width, gap: o.gap,
        speedOffset: o.speedOffset, followed: !!o.followingObstacleCreated,
      })),
    };
  }

  const key = (type, code) => document.dispatchEvent(new KeyboardEvent(type, { keyCode: code, bubbles: true }));

  window.__fake = {
    tape,
    callers,
    snapshot,
    now: () => t,
    blinkCount: () => R().tRex.blinkCount,
    // One browser frame: clock moves, input events, animation end event, then the rAF callbacks.
    step(input) {
      t = t + input.dt;
      const a = { dt: input.dt };
      if (input.jump) { key("keydown", 32); a.jump = true; }
      if (input.duck) { key("keydown", 40); a.duck = true; }
      if (input.jumpUp) { key("keyup", 32); a.jumpUp = true; }
      if (input.duckUp) { key("keyup", 40); a.duckUp = true; }
      if (input.enter) { key("keyup", 13); a.enter = true; }
      const r = R();
      if (r.playingIntro && introStart === null) introStart = t - input.dt; // first frame the intro was seen
      const auto = input.animEnd === undefined ? r.playingIntro && introStart !== null && t - introStart >= introMs : input.animEnd;
      if (auto) {
        r.containerEl.dispatchEvent(new Event("webkitAnimationEnd"));
        a.animEnd = true;
        introStart = null;
      }
      running = queue;
      queue = [];
      for (const q of running) if (!q.cancelled) q.cb(t);
      running = null;
      const s = snapshot();
      if (s.playingIntro && introStart === null) introStart = t; // intro started in this frame
      return { applied: a, state: s };
    },
  };
}

export async function openOriginal({ seed, visualSeed } = {}) {
  const { chromium } = loadPlaywright();
  const gameSeed = seed ?? 1;
  const vSeed = visualSeed ?? ((gameSeed * 7919 + 13) >>> 0);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", (route) => (route.request().url().startsWith("file:") ? route.continue() : route.abort()));
  await page.addInitScript(installFakes, { gameSeed, visualSeed: vSeed, clock0: CLOCK0, introMs: INTRO_MS });
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;-webkit-animation:none!important;transition:none!important}" });
  await page.waitForFunction(() => window.Runner && window.Runner.instance_ && window.Runner.instance_.tRex);
  const width = await page.evaluate(() => window.Runner.instance_.dimensions.WIDTH);
  if (width !== 600) throw new Error(`canvas width is ${width}, the recording assumes 600`);
  return {
    page,
    initial: () => page.evaluate(() => window.__fake.snapshot()),
    step: (input) => page.evaluate((i) => window.__fake.step(i), input),
    tape: () => page.evaluate(() => window.__fake.tape.slice()),
    callers: () => page.evaluate(() => ({ ...window.__fake.callers })),
    blinkCount: () => page.evaluate(() => window.__fake.blinkCount()),
    shot: (file) => page.screenshot({ path: file }),
    errors,
    close: () => browser.close(),
  };
}
