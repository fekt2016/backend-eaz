/**
 * Read-only pre-flight check for customer hosting provisioning (WHM).
 *
 *   npm run check:whm
 *
 * Run this the moment WHM_HOST / WHM_USER / WHM_TOKEN are filled in, and again
 * after creating the packages in WHM — BEFORE the first hosting order is sold.
 *
 * Why: `utils/provisionHosting.js` only auto-provisions `shared` and `wordpress`
 * plans, and `whm.createAccount` derives the package name as
 * `<prefix>_eazworld_<planType>_<tier>`. If that package does not exist on the
 * server, `createacct` fails on an order the customer has ALREADY PAID for, and
 * the order lands in the awaiting-provisioning queue with an obscure error.
 * This check surfaces the mismatch while it is still free to fix.
 *
 * It touches no database and creates nothing — it reads config, calls WHM
 * `listpkgs`, and compares that list against config/hostingPlans.js.
 */
const dotenv = require("dotenv");
const whm = require("../services/whm");
const { HOSTING_PLANS } = require("../config/hostingPlans");

dotenv.config({ path: "./.env" });

// Mirrors the autoProvisionTypes list in utils/provisionHosting.js — vps/cloud/
// email are built by hand and need no WHM package.
const AUTO_PROVISION_TYPES = ["shared", "wordpress"];

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);

async function main() {
  let failed = false;

  console.log("\nWHM provisioning pre-flight\n");

  // ── 1. Config ──────────────────────────────────────────────────────────────
  console.log("Configuration");
  if (!whm.hasConfig()) {
    bad("WHM_HOST and/or WHM_TOKEN are not set — every paid shared/wordpress");
    console.log("    order will be marked 'skipped' and must be built by hand.");
    console.log("    See docs/HOSTING.md § Customer hosting provisioning.\n");
    process.exit(1);
  }
  ok(`WHM_HOST  ${process.env.WHM_HOST}`);

  const host = process.env.WHM_HOST || "";
  if (!/^https:\/\//.test(host)) {
    bad("WHM_HOST must start with https:// — the code concatenates it directly.");
    failed = true;
  }
  if (!/:2087(\/|$)/.test(host)) {
    warn("WHM_HOST has no :2087 port. WHM listens on 2087 (cPanel is 2083).");
  }
  if (host.endsWith("/")) {
    warn("WHM_HOST has a trailing slash — it produces a '//json-api' URL.");
  }

  const user = process.env.WHM_USER || "root";
  if (user === "root") {
    bad("WHM_USER is 'root'. A Namecheap reseller account is never root —");
    console.log("    set it to your reseller username (also the package prefix).");
    failed = true;
  } else {
    ok(`WHM_USER  ${user}`);
  }
  ok(`package prefix  ${whm.packagePrefix()}`);

  // ── 2. Connectivity + token ────────────────────────────────────────────────
  console.log("\nConnection");
  const res = await whm.listPackages();
  if (!res.success) {
    bad(`listpkgs failed: ${res.error}`);
    console.log("    Common causes: wrong host or port, token revoked, or the");
    console.log("    token lacks the 'list-pkgs' ACL. Regenerate in WHM →");
    console.log("    Development → Manage API Tokens.\n");
    process.exit(1);
  }
  ok(`authenticated — ${res.packages.length} package(s) visible`);

  // ── 3. Every auto-provisioned tier has a package ───────────────────────────
  console.log("\nPackages (auto-provisioned tiers only)");
  const existing = new Set(res.packages.map((p) => p.toLowerCase()));
  const missing = [];

  for (const planType of AUTO_PROVISION_TYPES) {
    for (const tier of Object.keys(HOSTING_PLANS[planType] || {})) {
      const name = whm.planPackageName(planType, tier);
      if (existing.has(name.toLowerCase())) {
        ok(name);
      } else {
        bad(`${name}  — MISSING`);
        missing.push(name);
      }
    }
  }

  if (missing.length) {
    failed = true;
    console.log(
      `\n  ${missing.length} package(s) missing. Create them in WHM → Packages →`
    );
    console.log("  Add a Package, at the quotas in docs/HOSTING.md § The seven");
    console.log("  packages to create. Selling a tier without its package means a");
    console.log("  paying customer gets no account.");
  }

  // Packages on the server we do not sell are fine — just noted, not a failure.
  const known = new Set(
    AUTO_PROVISION_TYPES.flatMap((t) =>
      Object.keys(HOSTING_PLANS[t] || {}).map((tier) =>
        whm.planPackageName(t, tier).toLowerCase()
      )
    )
  );
  const extra = res.packages.filter((p) => !known.has(p.toLowerCase()));
  if (extra.length) {
    console.log(`\n  Other packages on the server (not sold): ${extra.join(", ")}`);
  }

  // ── 4. Manual tiers, for completeness ──────────────────────────────────────
  const manual = Object.keys(HOSTING_PLANS).filter(
    (t) => !AUTO_PROVISION_TYPES.includes(t)
  );
  if (manual.length) {
    console.log(
      `\n  Built by hand (no WHM package needed): ${manual.join(", ")} —`
    );
    console.log("  these sit at provisioningStatus 'skipped' in the queue at");
    console.log("  GET /api/v1/hosting/orders/awaiting-provisioning.");
  }

  console.log(
    failed
      ? "\n\x1b[31mNot ready to sell hosting.\x1b[0m Fix the items above.\n"
      : "\n\x1b[32mReady.\x1b[0m WHM reachable and every sellable tier has a package.\n"
  );
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nPre-flight crashed: ${err.message}\n`);
  process.exit(1);
});
