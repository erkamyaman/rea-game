// Bricks: the rules of the brick-breaking game, as pure logic. No DOM, no real clock, no Math.random:
// the caller hands in `rng` (a function returning [0,1)) and the brick layouts, and calls step(input) once
// per input. The game keeps its own clock and timer queue, because the original's frame loop and its launch
// countdown are timers (an interval and one-second timeouts), and their order decides what happens.
// Written from games/bricks/GAME.md (what the original does, observed and read), not copied.

export const T0 = 1000000; // the recording's clock starts here (ms)
export const KEY = { left: 37, right: 39, a: 65, d: 68, space: 32, enter: 13, esc: 27, up: 38, down: 40 };
export const COLS = 30, ROWS = 25;           // the court, in chunks
export const MAX_LIVES = 5, START_LIVES = 3;
export const FRAME_MS = 1000 / 60;           // the frame loop's interval
const BALL_RADIUS = 0.3, BALL_SPEED = 15, PADDLE_W = 6, PADDLE_H = 1, PADDLE_SPEED = 20; // in chunks (per second)
const LABELS = { 3: "ready...", 2: "set..", 1: "go!" };

// a box with its edges, the way every collision test reads it
function edges(b) { b.left = b.x; b.right = b.x + b.w; b.top = b.y; b.bottom = b.y + b.h; return b; }

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

// the first face of `box` (grown by the ball's radius) that the ball's path (nx, ny) crosses: a side face
// first (the one facing the motion), and only when none, the top or bottom face
function hitFace(ball, box, nx, ny) {
  const r = ball.r, x2 = ball.x + nx, y2 = ball.y + ny;
  let p = null;
  if (nx < 0) p = cross(ball.x, ball.y, x2, y2, box.right + r, box.top - r, box.right + r, box.bottom + r, "right");
  else if (nx > 0) p = cross(ball.x, ball.y, x2, y2, box.left - r, box.top - r, box.left - r, box.bottom + r, "left");
  if (!p) {
    if (ny < 0) p = cross(ball.x, ball.y, x2, y2, box.left - r, box.bottom + r, box.right + r, box.bottom + r, "bottom");
    else if (ny > 0) p = cross(ball.x, ball.y, x2, y2, box.left - r, box.top - r, box.right + r, box.top - r, "top");
  }
  return p;
}

export class Bricks {
  // levels: per level, its bricks as [firstColumn, lastColumn, row, points]
  constructor({ rng, levels, clock0 = T0, width = 640, height = 480, highscore = 1000 }) {
    this.rng = rng;
    this.levels = levels;
    this.width = width;
    this.height = height;
    this.t = clock0;
    this.timers = [];       // {due, seq, every, fn}
    this.seq = 0;
    this.answer = true;     // what "Abandon game?" gets answered
    this.highscore = highscore;
    this.level = 0;
    this.score = 0;
    this.vscore = 0;
    this.lives = START_LIVES;
    this.layout();
    this.state = "menu";
    this.enterMenu();
    this.startLoop();
  }

  // ---- sizes: everything is measured in chunks of the canvas
  layout() {
    const c = Math.floor(Math.min(this.width, this.height) / (Math.max(COLS, ROWS) + 4));
    this.chunk = c;
    const w = COLS * c, h = ROWS * c;
    this.court = { left: Math.floor((this.width - w) / 2), top: Math.floor((this.height - h) / 2) };
    this.court.right = this.court.left + w;
    this.court.bottom = this.court.top + h;
    this.court.width = w;
    const { left, top, right } = this.court;
    this.walls = [
      edges({ x: left - c, y: top - c * 2, w: w + c * 2, h: c * 2 }),       // top
      edges({ x: left - c, y: top - c * 2, w: c, h: c * 2 + h }),           // left
      edges({ x: right, y: top - c * 2, w: c, h: c * 2 + h }),              // right
    ];
    this.paddle = { w: PADDLE_W * c, h: PADDLE_H * c, speed: PADDLE_SPEED * c, minX: left, maxX: right - PADDLE_W * c, x: 0, y: 0, dl: 0, dr: 0 };
  }

  // ---- timers (the original's frame loop is an interval, its countdown a chain of timeouts)
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
  stopLoop() { this.cancel(this.loop); }

  frame() {
    const now = this.now();
    this.update((now - this.last) / 1000);
    this.last = now;
  }

  // ---- one frame: paddle, ball, shown score
  update(dt) {
    const p = this.paddle;
    const amount = p.dr - p.dl;
    if (amount !== 0) this.placePaddle(p.x + (amount * dt * p.speed));
    this.moveBall(dt);
    if (this.vscore < this.score) this.vscore = Math.min(this.score, this.vscore + 10);
  }

  placePaddle(x) {
    const p = this.paddle;
    p.x = Math.min(p.maxX, Math.max(p.minX, x));
    edges(p);
  }

  // ---- the brick layout of a level
  setLevel(n) {
    n = n < this.levels.length ? n : 0;
    const c = this.chunk, { left, top } = this.court;
    this.bricks = this.levels[n].map(([x1, x2, y, points]) => edges({ x: left + x1 * c, y: top + y * c, w: (x2 - x1 + 1) * c, h: c, points, hit: false }));
    this.hits = 0;
    this.level = n;
  }

  // ---- the ball
  setBall(x, y) { const b = this.ball; b.x = x; b.y = y; }
  aimBall(dx, dy) {
    const b = this.ball;
    const m = Math.sqrt(dx * dx + dy * dy);
    if (m === 0) { b.dx = 0; b.dy = 0; b.moving = false; return; }
    b.dx = dx / m; b.dy = dy / m; b.moving = true;
  }
  onPaddle() { const p = this.paddle; this.setBall(p.x + p.w / 2, this.court.bottom - p.h - this.ball.r); }
  resetBall(launch) {
    const c = this.chunk;
    const speed = BALL_SPEED * c;
    this.ball = { r: BALL_RADIUS * c, speed, max: speed * 1.5, x: 0, y: 0, dx: 0, dy: 0, moving: false, countdown: this.ball ? this.ball.countdown : null, label: this.ball ? this.ball.label : null, timer: this.ball ? this.ball.timer : null };
    this.onPaddle();
    this.aimBall(0, 0);
    this.stopCountdown();
    this.targets = [this.paddle, ...this.walls, ...this.bricks];
    if (launch) this.countdownTick();
  }
  stopCountdown() {
    const b = this.ball;
    if (b.timer) { this.cancel(b.timer); b.timer = null; b.label = null; b.countdown = null; }
  }
  // 3 "ready...", 2 "set..", 1 "go!" (the ball starts moving), then the label goes; one second apart
  countdownTick() {
    const b = this.ball;
    if (b.moving && !b.countdown) return;
    b.countdown = b.countdown === null ? 3 : b.countdown - 1;
    if (b.countdown > 0) {
      b.label = LABELS[b.countdown];
      b.timer = this.schedule(1000, () => this.countdownTick());
      if (b.countdown === 1) this.aimBall(1, -1);
    } else this.stopCountdown();
  }
  launchNow() { if (!this.ball.moving) { this.stopCountdown(); this.aimBall(1, -1); } }

  moveBall(dt) {
    for (;;) {
      const b = this.ball;
      if (!b.moving) { this.onPaddle(); return; }
      const vx = b.dx * b.speed, vy = b.dy * b.speed;
      const nx = vx * dt, ny = vy * dt;
      let best = null, bestDist = Infinity;
      for (const box of this.targets) {
        if (box.hit) continue;
        const p = hitFace(b, box, nx, ny);
        if (!p) continue;
        const ex = p.x - b.x, ey = p.y - b.y;
        const d = Math.sqrt(ex * ex + ey * ey);
        if (d < bestDist) { bestDist = d; best = { box, p }; }
      }
      if (!best) {
        const x = b.x + nx, y = b.y + ny;
        if (x < 0 || y < 0 || x > this.width || y > this.height) this.loseBall();
        else { this.setBall(x, y); this.aimBall(vx, vy); }
        return;
      }
      let outX = vx;
      if (best.box.points !== undefined) {
        this.hitBrick(best.box);
        if (!this.ball.moving) return; // the last brick: a new level, the ball back on the paddle
      }
      const p = this.paddle;
      if (best.box === p && best.p.side === "top") outX = b.speed * (best.p.x - (p.left + p.w / 2)) / (p.w / 2);
      this.setBall(best.p.x, best.p.y);
      if (best.p.side === "left" || best.p.side === "right") this.aimBall(-outX, vy); else this.aimBall(outX, -vy);
      dt = dt - dt * (bestDist / Math.sqrt(nx * nx + ny * ny));
    }
  }

  hitBrick(brick) {
    brick.hit = true;
    this.hits++;
    this.score = this.score + brick.points;
    const b = this.ball;
    b.speed += 10 * (1 - (b.speed / b.max));
    if (this.hits === this.bricks.length) {
      this.lives = Math.min(MAX_LIVES, this.lives + 1);
      this.setLevel(this.level + 1);
      this.resetBall(true);
    }
  }

  loseBall() {
    this.lives = this.lives - 1;
    if (this.lives === 0) this.toMenu();
    else this.resetBall(true);
  }

  // ---- game and menu
  enterMenu() {
    this.setLevel(this.level);
    const p = this.paddle;
    p.x = p.minX + (this.rng() * (p.maxX - p.minX));
    p.y = this.court.bottom - p.h;
    edges(p);
    p.dl = 0; p.dr = 0;
    this.resetBall(false);
  }
  toMenu() {
    if (this.score > this.highscore) this.highscore = this.score;
    this.lives = START_LIVES;
    this.state = "menu";
    this.enterMenu();
  }
  play() {
    this.state = "game";
    this.score = 0; this.vscore = 0;
    this.lives = START_LIVES;
    this.resetBall(true);
  }
  abandon() {
    // the original asks "Abandon game?" and restarts its frame loop around the question, whatever the answer
    this.stopLoop();
    const yes = this.answer;
    this.startLoop();
    if (yes) this.toMenu();
  }

  // ---- keys: arrows (or A and D) held move the paddle; the rest act when the key comes up
  keyDown(code) {
    if (code === KEY.left || code === KEY.a) this.paddle.dl = 1;
    if (code === KEY.right || code === KEY.d) this.paddle.dr = 1;
  }
  keyUp(code) {
    const s = this.state; // a key acts in the state it was pressed in, even if an earlier action changed it
    if (code === KEY.left || code === KEY.a) this.paddle.dl = 0;
    if (code === KEY.right || code === KEY.d) this.paddle.dr = 0;
    if ((code === KEY.space || code === KEY.enter) && s === "menu") this.play();
    if ((code === KEY.space || code === KEY.enter) && s === "game") this.launchNow();
    if (code === KEY.esc && s === "game") this.abandon();
    if (code === KEY.up && s === "menu" && this.state === "menu" && this.level < this.levels.length - 1) this.setLevel(this.level + 1);
    if (code === KEY.down && s === "menu" && this.state === "menu" && this.level > 0) this.setLevel(this.level - 1);
  }

  // one input: key events in order ("+left" down, "-left" up), then the clock moves by dt ms
  step({ dt, keys = [], late = false, answer = true }) {
    this.answer = answer;
    for (const k of keys) (k[0] === "+" ? this.keyDown(KEY[k.slice(1)]) : this.keyUp(KEY[k.slice(1)]));
    this.advance(dt, late);
  }

  snapshot() {
    const b = this.ball, p = this.paddle;
    return {
      state: this.state, level: this.level,
      score: this.score, vscore: this.vscore, highscore: this.highscore, lives: this.lives,
      paddle: { x: p.x, left: p.dl, right: p.dr },
      ball: { x: b.x, y: b.y, dx: b.dx, dy: b.dy, speed: b.speed, moving: b.moving, countdown: b.countdown, label: b.label },
      bricks: this.bricks.map((k) => (k.hit ? "x" : "o")).join(""),
      last: this.last,
    };
  }
}
