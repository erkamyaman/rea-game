// Paddles: the rules of the two-paddle ball game, as pure logic. No DOM, no real clock, no Math.random:
// the caller hands in `rng` (a function returning [0,1)) and calls step(input) once per input. The game keeps
// its own clock and timer queue, because the original's frame loop is a 60 Hz interval that the "abandon?"
// question stops and restarts.
// Written from games/paddles/GAME.md (what the original does, observed and read), not copied.

export const T0 = 1000000; // the recording's clock starts here (ms)
export const KEY = { 0: 48, 1: 49, 2: 50, esc: 27, q: 81, a: 65, p: 80, l: 76 };
export const W = 640;
export const H = 480;
export const WALL = 12;
export const PADDLE_W = 12;
export const PADDLE_H = 60;
export const RADIUS = 5;
export const WIN = 9;
export const FRAME_MS = 1000 / 60;
const PADDLE_CROSS_S = 2, BALL_CROSS_S = 4, ACCEL = 8;
// the computer's skill, from 0 (behind by 8 points: quick and accurate) to 16 (ahead by 8: slow and sloppy)
export const LEVELS = [
  [0.2, 40], [0.3, 50], [0.4, 60], [0.5, 70], [0.6, 80], [0.7, 90], [0.8, 100], [0.9, 110], [1.0, 120],
  [1.1, 130], [1.2, 140], [1.3, 150], [1.4, 160], [1.5, 170], [1.6, 180], [1.7, 190], [1.8, 200],
].map(([reaction, error]) => ({ reaction, error }));

// where the segment (x1,y1)-(x2,y2) crosses the segment (x3,y3)-(x4,y4), or null
function cross(x1, y1, x2, y2, x3, y3, x4, y4, side) {
  const den = ((y4 - y3) * (x2 - x1)) - ((x4 - x3) * (y2 - y1));
  if (den === 0) return null;
  const ua = (((x4 - x3) * (y1 - y3)) - ((y4 - y3) * (x1 - x3))) / den;
  if (ua < 0 || ua > 1) return null;
  const ub = (((x2 - x1) * (y1 - y3)) - ((y2 - y1) * (x1 - x3))) / den;
  if (ub < 0 || ub > 1) return null;
  return { x: x1 + (ua * (x2 - x1)), y: y1 + (ua * (y2 - y1)), side };
}

// the first face of `box` (grown by the ball's radius) that the path (nx, ny) from the ball crosses: the side
// face that faces the motion first, and only when it misses, the top or bottom face
function hitFace(ball, box, nx, ny) {
  const r = RADIUS, x2 = ball.x + nx, y2 = ball.y + ny;
  let p = null;
  if (nx < 0) p = cross(ball.x, ball.y, x2, y2, box.right + r, box.top - r, box.right + r, box.bottom + r, "right");
  else if (nx > 0) p = cross(ball.x, ball.y, x2, y2, box.left - r, box.top - r, box.left - r, box.bottom + r, "left");
  if (!p) {
    if (ny < 0) p = cross(ball.x, ball.y, x2, y2, box.left - r, box.bottom + r, box.right + r, box.bottom + r, "bottom");
    else if (ny > 0) p = cross(ball.x, ball.y, x2, y2, box.left - r, box.top - r, box.right + r, box.top - r, "top");
  }
  return p;
}

class Paddle {
  constructor(right) {
    this.minY = WALL;
    this.maxY = H - WALL - PADDLE_H;
    this.speed = (this.maxY - this.minY) / PADDLE_CROSS_S;
    this.left = right ? W - PADDLE_W : 0;
    this.right = this.left + PADDLE_W;
    this.place(this.minY + (this.maxY - this.minY) / 2);
    this.up = 0; this.down = 0;
    this.auto = false;
    this.level = null;      // index into LEVELS, kept when the computer lets go of the paddle
    this.guess = null;      // the computer's prediction: {x, y, dx, dy, since, exactY}
  }
  place(y) { this.y = y; this.top = y; this.bottom = y + PADDLE_H; }
  setAuto(on, level) {
    if (on && !this.auto) { this.auto = true; this.setLevel(level); }
    else if (!on && this.auto) { this.auto = false; this.up = 0; this.down = 0; }
  }
  setLevel(level) { if (this.auto) this.level = level; }
}

export class Paddles {
  constructor({ rng, clock0 = T0 }) {
    this.rng = rng;
    this.t = clock0;
    this.timers = [];
    this.seq = 0;
    this.answer = true;     // what "abandon the game?" gets answered
    this.playing = false;
    this.scores = [0, 0];
    this.winner = null;
    this.paddles = [new Paddle(false), new Paddle(true)];
    this.ball = { x: null, y: null, dx: null, dy: null };
    this.startLoop();
  }

  // ---- timers (the original's frame loop is an interval)
  schedule(ms, fn, every = null) { const tm = { due: this.t + ms, seq: this.seq++, every, fn }; this.timers.push(tm); return tm; }
  cancel(tm) { const i = this.timers.indexOf(tm); if (i >= 0) this.timers.splice(i, 1); }
  advance(ms, late) {
    const target = this.t + ms;
    if (late) this.t = target;
    for (;;) {
      let next = null;
      for (const tm of this.timers) if (tm.due <= target && (!next || tm.due < next.due || (tm.due === next.due && tm.seq < next.seq))) next = tm;
      if (!next) break;
      if (next.due > this.t) this.t = next.due;
      if (next.every === null) this.cancel(next); else { next.due = this.t + next.every; next.seq = this.seq++; }
      next.fn();
    }
    this.t = target;
  }
  now() { return Math.floor(this.t); }
  startLoop() { this.last = this.now(); this.loop = this.schedule(FRAME_MS, () => this.frame(), FRAME_MS); }
  frame() {
    const now = this.now();
    this.update((now - this.last) / 1000);
    this.last = now;
  }

  // ---- one frame
  update(dt) {
    for (const p of this.paddles) this.movePaddle(p, dt);
    if (!this.playing) return;
    this.moveBall(dt);
    const b = this.ball;
    if (b.x - RADIUS > W) this.goal(0);
    else if (b.x + RADIUS < 0) this.goal(1);
  }

  movePaddle(p, dt) {
    if (p.auto) this.think(p, dt);
    const amount = p.down - p.up;
    if (amount !== 0) {
      let y = p.y + (amount * dt * p.speed);
      if (y < p.minY) y = p.minY;
      else if (y > p.maxY) y = p.maxY;
      p.place(y);
    }
  }

  // the computer: once the ball has passed it, stand still; otherwise steer towards its (noisy) prediction
  think(p, dt) {
    const b = this.ball;
    if ((b.x < p.left && b.dx < 0) || (b.x > p.right && b.dx > 0)) { p.up = 0; p.down = 0; return; }
    this.predict(p, dt);
    if (!p.guess) return; // no prediction: the keys stay as they were
    if (p.guess.y < (p.top + PADDLE_H / 2 - 5)) { p.down = 0; p.up = 1; }
    else if (p.guess.y > (p.bottom - PADDLE_H / 2 + 5)) { p.up = 0; p.down = 1; }
    else { p.up = 0; p.down = 0; }
  }

  predict(p, dt) {
    const b = this.ball, g = p.guess;
    if (g && (g.dx * b.dx) > 0 && (g.dy * b.dy) > 0 && g.since < LEVELS[p.level].reaction) { g.since += dt; return; }
    const pt = hitFace(b, { left: p.left, right: p.right, top: -10000, bottom: 10000 }, b.dx * 10, b.dy * 10);
    if (!pt) { p.guess = null; return; }
    const top = p.minY + RADIUS, bottom = p.maxY + PADDLE_H - RADIUS;
    let y = pt.y;
    while ((y < top) || (y > bottom)) { // fold the line back into the court, wall by wall
      if (y < top) y = top + (top - y);
      else if (y > bottom) y = top + (bottom - top) - (y - bottom);
    }
    const closeness = (b.dx < 0 ? b.x - p.right : p.left - b.x) / W;
    const error = LEVELS[p.level].error * closeness;
    p.guess = { x: pt.x, y: y + (-error + (this.rng() * (error - -error))), dx: b.dx, dy: b.dy, since: 0, exactY: y };
  }

  moveBall(dt) {
    const b = this.ball;
    // speed grows by ACCEL every second, in the direction of travel; the position takes half a step of it, and
    // vertically always downwards
    const half = ACCEL * dt * dt * 0.5;
    const nx = (b.x + (dt * b.dx) + half) - b.x, ny = (b.y + (dt * b.dy) + half) - b.y;
    let x = b.x + (dt * b.dx) + half, y = b.y + (dt * b.dy) + half;
    let dx = b.dx + (ACCEL * dt) * (b.dx > 0 ? 1 : -1), dy = b.dy + (ACCEL * dt) * (b.dy > 0 ? 1 : -1);
    const lo = WALL + RADIUS, hi = H - WALL - RADIUS;
    if (dy > 0 && y > hi) { y = hi; dy = -dy; }
    else if (dy < 0 && y < lo) { y = lo; dy = -dy; }
    const p = dx < 0 ? this.paddles[0] : this.paddles[1];
    const hit = hitFace(b, p, nx, ny);
    if (hit) {
      if (hit.side === "left" || hit.side === "right") { x = hit.x; dx = -dx; }
      else { y = hit.y; dy = -dy; }
      // a moving paddle adds or takes away spin
      if (p.up) dy = dy * (dy < 0 ? 0.5 : 1.5);
      else if (p.down) dy = dy * (dy > 0 ? 0.5 : 1.5);
    }
    b.x = x; b.y = y; b.dx = dx; b.dy = dy;
  }

  serve(from) {
    const b = this.ball, minX = RADIUS, maxX = W - RADIUS, lo = WALL + RADIUS, hi = H - WALL - RADIUS;
    const speed = (maxX - minX) / BALL_CROSS_S;
    b.x = from === 1 ? maxX : minX;
    b.y = lo + (this.rng() * (hi - lo));
    b.dx = from === 1 ? -speed : speed;
    b.dy = speed;
  }

  level(n) { return 8 + (this.scores[n] - this.scores[n ? 0 : 1]); }

  goal(n) {
    this.scores[n] += 1;
    if (this.scores[n] === WIN) { this.winner = n; this.stop(false); return; }
    this.serve(n);
    this.paddles[0].setLevel(this.level(0));
    this.paddles[1].setLevel(this.level(1));
  }

  start(players) {
    if (this.playing) return;
    this.scores = [0, 0];
    this.playing = true;
    this.paddles[0].setAuto(players < 1, this.level(0));
    this.paddles[1].setAuto(players < 2, this.level(1));
    this.serve(null);
  }

  stop(ask) {
    if (!this.playing) return;
    if (ask) {
      // the original stops its frame loop around the question and starts it again, whatever the answer
      this.cancel(this.loop);
      const yes = this.answer;
      this.startLoop();
      if (!yes) return;
    }
    this.playing = false;
    this.paddles[0].setAuto(false);
    this.paddles[1].setAuto(false);
  }

  // ---- keys: 0, 1, 2 start a game with that many players; Esc asks to abandon; Q/A and P/L move a paddle
  // that a person holds (held while the key is down)
  keyDown(code) {
    const [l, r] = this.paddles;
    if (code === KEY[0]) this.start(0);
    else if (code === KEY[1]) this.start(1);
    else if (code === KEY[2]) this.start(2);
    else if (code === KEY.esc) this.stop(true);
    else if (code === KEY.q) { if (!l.auto) l.up = 1; }
    else if (code === KEY.a) { if (!l.auto) l.down = 1; }
    else if (code === KEY.p) { if (!r.auto) r.up = 1; }
    else if (code === KEY.l) { if (!r.auto) r.down = 1; }
  }
  keyUp(code) {
    const [l, r] = this.paddles;
    if (code === KEY.q) { if (!l.auto) l.up = 0; }
    else if (code === KEY.a) { if (!l.auto) l.down = 0; }
    else if (code === KEY.p) { if (!r.auto) r.up = 0; }
    else if (code === KEY.l) { if (!r.auto) r.down = 0; }
  }

  // one input: key events in order ("+q" down, "-q" up), then the clock moves by dt ms
  step({ dt, keys = [], late = false, answer = true }) {
    this.answer = answer;
    for (const k of keys) (k[0] === "+" ? this.keyDown(KEY[k.slice(1)]) : this.keyUp(KEY[k.slice(1)]));
    this.advance(dt, late);
  }

  snapshot() {
    const paddle = (p) => ({
      y: p.y, up: p.up, down: p.down, auto: p.auto, level: p.level,
      prediction: p.guess ? { x: p.guess.x, y: p.guess.y, dx: p.guess.dx, dy: p.guess.dy, since: p.guess.since, exactY: p.guess.exactY } : null,
    });
    const b = this.ball;
    return {
      playing: this.playing, scores: this.scores.slice(), winner: this.winner,
      left: paddle(this.paddles[0]), right: paddle(this.paddles[1]),
      ball: { x: b.x, y: b.y, dx: b.dx, dy: b.dy },
      last: this.last,
    };
  }
}
