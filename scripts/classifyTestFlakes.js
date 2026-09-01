/**
 * Full-suite regression classifier (T108).
 *
 * The serial suite has a long-standing, order-dependent connection flake that
 * fails ~1 test per full run in a small fraction of runs, and *never* the same
 * test twice. Every documented failure passes green in isolation — so a red
 * full run has always had to be hand-decided: is this a real regression, or
 * the known flake? That judgment took ~10 minutes per occurrence, repeatedly.
 *
 * This makes the call one command. It runs the full suite, then independently
 * re-runs each failing test file ALONE. A test that passes on its own is
 * flake (classed `FLAKE`); one that still fails is a real regression (classed
 * `FAIL`). Exit code: 0 only when every initial failure is individually green
 * (i.e. a fully flake-caused run).
 *
 * "Alone" means exactly that file, NOT the rest of the suite — the flake never
 * reproduces in isolation, so a failure that survives alone is by definition
 * not the ordering bug. That is the FLAKE-vs-FAIL boundary the tracker relies on.
 *
 * Usage: node scripts/classifyTestFlakes.js
 *   (equivalent npm script: `test:ci`)
 */
const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const run = (args, opts = {}) =>
  execSync(args.join(" "), { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], ...opts })
    .toString();

let full;
try {
  full = run(["npx", "jest", "--runInBand"]);
} catch (err) {
  full = err.stdout.toString();
}

// Collect failing test files from the full run's report block. Jest prints
// "FAIL tests/<file>" per failed suite.
// Strip ANSI colour codes — jest wraps FAIL/status lines in escape codes that
// would otherwise sit between "FAIL" and the filename (e.g. `FAIL<reset> file`).
// Built via RegExp with a string so the control character is not a literal
// escape in the source (keeps the `no-control-regex` lint rule quiet).
const ANSI_RE = new RegExp(String.fromCharCode(0x1b) + "\\[[0-9;]*m", "g");
const plain = full.replace(ANSI_RE, "");

const failedFiles = [
  ...plain.matchAll(/^FAIL\s+(tests\/\S+\.test\.js)/gm),
].map((m) => m[1]);
const failedTests = [
  ...plain.matchAll(/^(\s*● .*)$/gm),
].map((m) => m[1].trim());

console.log(`Full run: ${failedFiles.length ? failedFiles.length + " failing suite(s)" : "ALL GREEN"}`);
if (!failedFiles.length) {
  console.log("✅ No failures — nothing to classify.");
  process.exit(0);
}
console.log("Failing tests from the full run:");
for (const t of failedTests) console.log("  " + t);

// Re-run each failing FILE alone.
console.log("\n── Classifying each failing file alone ──");
const flaky = [];
const real = [];
for (const file of failedFiles) {
  process.stdout.write(`  ${file} → `);
  try {
    run(["npx", "jest", "--runInBand", file]);
    console.log("GREEN in isolation");
    flaky.push(file);
  } catch {
    console.log("STILL FAILS alone");
    real.push(file);
  }
}

console.log("\n────────────────────────────────────────");
if (real.length) {
  console.log("❌ REAL REGRESSION(S) — investigate, do NOT dismiss as flake:");
  for (const f of real) console.log("    " + f);
  process.exit(1);
}
console.log("✅ All failures were order-dependent flakes (T108) — not regressions.");
if (flaky.length) {
  console.log("Flaked files (green alone):");
  for (const f of flaky) console.log("    " + f);
  console.log("Log today's victims in tasks.md T108 if a new suite is added.");
}
process.exit(0);