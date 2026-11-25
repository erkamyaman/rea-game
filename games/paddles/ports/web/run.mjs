// Runner protocol: a case on stdin, the port's trace on stdout.
import { Paddles } from "./paddles.mjs";

const c = JSON.parse(await new Promise((r) => { let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => r(s)); }));
let used = 0;
const rng = () => { if (used >= c.tape.length) throw new Error("port asked for more random numbers than the original used"); return c.tape[used++]; };
const g = new Paddles({ rng, clock0: c.clock0 });
const trace = [g.snapshot()];
for (const i of c.inputs) {
  g.step(i);
  trace.push(g.snapshot());
}
process.stdout.write(JSON.stringify({ trace, tapeUsed: used }));
