/**
 * T45 — move existing batches onto the five-stage journey.
 *
 * The shipment journey used to be eight operational stages that collapsed into
 * four customer-facing ones. It is now ONE list of five, which staff drive and
 * customers see. Any Shipment saved before that change carries a stage name the
 * schema no longer accepts, so the next `save()` on it throws a validation
 * error — and any pre-order line's tracking history carries a `preorderStage`
 * key that no longer matches a step, so it renders undated.
 *
 * Dry run by default; pass --apply to write:
 *
 *   npm run migrate:preorder-stages
 *   npm run migrate:preorder-stages -- --apply
 */
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Shipment = require("../models/Shipment");
const Order = require("../models/Order");
const { logDbTarget } = require("../utils/dbTarget");

dotenv.config({ path: "./.env" });

const APPLY = process.argv.includes("--apply");

const mongoUrlRaw =
  process.env.MONGO_URL || process.env.mongo_url || process.env.MONGO_URI;
if (!mongoUrlRaw) {
  console.error("MONGO_URL is not defined in environment variables");
  process.exit(1);
}
const dbPassword = process.env.DATABASE_PASSWORD || process.env.database_password;
const db =
  mongoUrlRaw.includes("<PASSWORD>") && dbPassword
    ? mongoUrlRaw.replace("<PASSWORD>", dbPassword)
    : mongoUrlRaw;

// Old staff stage → new. The pairs that used to collapse into one customer
// stage collapse here too, which is why this is not reversible.
const STAGE_MAP = {
  ordered:        "production",
  production:     "production",
  ready_supplier: "container_warehouse",
  at_port_origin: "container_warehouse",
  in_transit:     "shipped",
  arrived_port:   "port_ghana",
  customs:        "port_ghana",
  at_shop:        "at_shop",
};

// Old customer stage key (as written into Order.trackingHistory) → new.
const CUSTOMER_MAP = {
  preparing:  "production",
  on_the_way: "shipped",
  in_ghana:   "port_ghana",
  at_shop:    "at_shop",
};

const isStale = (v) => v && !Object.values(STAGE_MAP).includes(v);

async function run() {
  await mongoose.connect(db, { maxPoolSize: 5, serverSelectionTimeoutMS: 5000, autoIndex: false });
  // Say WHICH database out loud: a bare run falls back to .env, which in this
  // repo points at the live cluster.
  logDbTarget(db);
  console.log(APPLY ? "\nAPPLY — writing changes\n" : "\nDRY RUN — nothing will be written (pass --apply)\n");

  // ── Shipments ───────────────────────────────────────────────────────────
  const shipments = await Shipment.find({}).lean();
  let shipmentsChanged = 0;

  for (const s of shipments) {
    const stage = STAGE_MAP[s.stage] || s.stage;
    // Several old stages map to one new one, so a batch that visited both keeps
    // only the EARLIEST — the date the customer was first shown that milestone.
    const byStage = new Map();
    for (const e of s.stageHistory || []) {
      const mapped = STAGE_MAP[e.stage] || e.stage;
      const seen = byStage.get(mapped);
      if (!seen || new Date(e.date) < new Date(seen.date)) {
        byStage.set(mapped, { ...e, stage: mapped });
      }
    }
    const history = [...byStage.values()].sort((a, b) => new Date(a.date) - new Date(b.date));

    const changed = stage !== s.stage || history.length !== (s.stageHistory || []).length
      || history.some((e, i) => e.stage !== s.stageHistory[i]?.stage);
    if (!changed) continue;

    shipmentsChanged += 1;
    console.log(`  ${s.reference}: ${s.stage} → ${stage} (${(s.stageHistory || []).length} → ${history.length} entries)`);
    if (APPLY) {
      await Shipment.updateOne({ _id: s._id }, { $set: { stage, stageHistory: history } });
    }
  }

  // ── Orders carrying a pre-order journey ─────────────────────────────────
  const orders = await Order.find({ "trackingHistory.preorderStage": { $nin: [null, ""] } })
    .select("orderNumber trackingHistory")
    .lean();
  let ordersChanged = 0;

  for (const o of orders) {
    const entries = (o.trackingHistory || []).map((e) =>
      e.preorderStage && CUSTOMER_MAP[e.preorderStage]
        ? { ...e, preorderStage: CUSTOMER_MAP[e.preorderStage] }
        : e,
    );
    if (!entries.some((e, i) => e.preorderStage !== o.trackingHistory[i].preorderStage)) continue;

    ordersChanged += 1;
    console.log(`  ${o.orderNumber}: journey entries relabelled`);
    if (APPLY) {
      await Order.updateOne({ _id: o._id }, { $set: { trackingHistory: entries } });
    }
  }

  const staleLeft = shipments.filter((s) => isStale(STAGE_MAP[s.stage] ? null : s.stage));
  console.log(`\nShipments ${APPLY ? "updated" : "to update"}: ${shipmentsChanged} of ${shipments.length}`);
  console.log(`Orders ${APPLY ? "updated" : "to update"}: ${ordersChanged} of ${orders.length}`);
  if (staleLeft.length) {
    console.log(`\n⚠️  ${staleLeft.length} shipment(s) carry a stage this script does not know:`);
    staleLeft.forEach((s) => console.log(`   ${s.reference}: ${s.stage}`));
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Migration failed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
