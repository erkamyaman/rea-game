import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyGames, summaryLines, crashReason } from "../lib/verify.mjs";

// A port that answers every case with the recorded trace.
const ECHO_PORT = `let s = "";
process.stdin.on("data", (d) => (s += d));
process.stdin.on("end", () => {
  const c = JSON.parse(s);
  process.stdout.write(JSON.stringify({ trace: c.trace, tapeUsed: c.tape.length }));
});
`;

// games/<name> with one case and the given ports; every port runs ECHO_PORT unless it says otherwise.
function makeRoot(games) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rea-games-verify-"));
  for (const [name, ports] of Object.entries(games)) {
    const dir = path.join(root, "games", name);
    fs.mkdirSync(path.join(dir, "cases"), { recursive: true });
    fs.writeFileSync(path.join(dir, "port.mjs"), ECHO_PORT);
    fs.writeFileSync(path.join(dir, "cases", "one.json"), JSON.stringify({ inputs: [0, 1], tape: [0.5], trace: [{ s: 0 }, { s: 1 }] }));
    const meta = { name, original: { repo: "test/test", license: "MIT" }, ports: {} };
    for (const [port, extra] of Object.entries(ports)) meta.ports[port] = { cmd: ["node", "port.mjs"], ...extra };
    fs.writeFileSync(path.join(dir, "game.json"), JSON.stringify(meta));
  }
  return root;
}

const quiet = () => {};
const BROKEN_BUILD = { build: ["node", "-e", "process.exit(1)"] };

test("a failing build is that port's failure, and the other ports and games still run", () => {
  const root = makeRoot({ a: { web: {}, broken: BROKEN_BUILD, last: {} }, b: { web: {} } });
  try {
    const results = verifyGames(root, ["a", "b"], null, quiet);
    assert.deepEqual(results.map((r) => `${r.name}/${r.port}`), ["a/web", "a/broken", "a/last", "b/web"]);
    const broken = results.find((r) => r.port === "broken");
    assert.match(broken.error, /build of a\/broken failed/);
    for (const r of results.filter((r) => r !== broken)) assert.deepEqual([r.error, r.passed, r.cases], [undefined, 1, 1]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown port is reported for that game, not thrown", () => {
  const root = makeRoot({ a: { web: {} }, b: { web: {} } });
  try {
    const results = verifyGames(root, ["a", "b"], "nope", quiet);
    assert.equal(results.length, 2);
    for (const r of results) assert.match(r.error, /has no port "nope" \(has: web\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the log names the failure as it happens and ends with one line per port", () => {
  const wrong = { cmd: ["node", "-e", "process.stdout.write(JSON.stringify({ trace: [], tapeUsed: 0 }))"] };
  const root = makeRoot({ a: { web: {}, broken: BROKEN_BUILD, wrong } });
  try {
    const lines = [];
    const results = verifyGames(root, ["a"], null, (l) => lines.push(l));
    assert.ok(lines.includes("  FAIL build of a/broken failed"), lines.join("\n"));
    assert.deepEqual(summaryLines(results), [
      "a / web     => 1/1 cases identical, 2 inputs, 2 recorded states",
      "a / broken  => FAIL build of a/broken failed",
      "a / wrong   => FAIL 0/1 cases identical, 0 inputs, 0 recorded states",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a crashed Node port is reported with its error and where it was thrown", () => {
  const crash = { cmd: ["node", "-e", "throw new Error('boom')"] };
  const root = makeRoot({ a: { crash } });
  try {
    const [r] = verifyGames(root, ["a"], null, quiet);
    assert.equal(r.failures.length, 1);
    assert.match(r.failures[0].problem, /^port exited 1: Error: boom \| at \[eval\]:1:\d+$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("crashReason drops blank lines and the Node.js version line, and keeps a panic's last two lines", () => {
  const node = "[eval]:1\nthrow new Error('boom')\n^\n\nError: boom\n    at [eval]:1:7\n    at runScriptInThisContext (node:internal/vm:209:10)\n\nNode.js v22.23.5\n";
  assert.equal(crashReason(node), "Error: boom | at [eval]:1:7");
  const panic = "thread 'main' panicked at src/main.rs:3:5:\nboom\nnote: run with `RUST_BACKTRACE=1` environment variable to display a backtrace\n";
  assert.equal(crashReason(panic), "boom | note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace");
  assert.equal(crashReason(""), "");
});

test("crashReason takes the last message, not an error logged before it", () => {
  const recovered = "Error: recovered\n    at retry (runner.mjs:1:1)\nfatal: boom\n";
  assert.equal(crashReason(recovered), "at retry (runner.mjs:1:1) | fatal: boom");
  const logged = "Error: warning first\n    at warn (runner.mjs:1:1)\nrunner.mjs:2\nthrow new Error('boom')\n^\n\nError: boom\n    at runner.mjs:2:7\n\nNode.js v22.23.5\n";
  assert.equal(crashReason(logged), "Error: boom | at runner.mjs:2:7");
  const props = "Error: ENOENT: no such file or directory, open 'x'\n    at Object.openSync (node:fs:553:18)\n    at main (runner.mjs:1:4) {\n  errno: -2,\n  code: 'ENOENT'\n}\n\nNode.js v22.23.5\n";
  assert.equal(crashReason(props), "Error: ENOENT: no such file or directory, open 'x' | at Object.openSync (node:fs:553:18)");
});

test("crashReason keeps an error whose message goes on in indented lines before its stack", () => {
  const detail = "Error: boom\n  detail\n    at main (runner.mjs:1:1)\n    at start (runner.mjs:2:1)\n";
  assert.equal(crashReason(detail), "Error: boom | at main (runner.mjs:1:1)");
  const diff = "AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:\n+ actual - expected\n\n  {\n+   a: 1\n-   a: 2\n  }\n\n    at main (runner.mjs:1:1)\n    at start (runner.mjs:2:1) {\n  code: 'ERR_ASSERTION',\n  operator: 'deepStrictEqual'\n}\n\nNode.js v22.23.5\n";
  assert.equal(crashReason(diff), "-   a: 2 | at main (runner.mjs:1:1)");
});
