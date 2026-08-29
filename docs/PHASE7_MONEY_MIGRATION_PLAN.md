# Phase 2 · #7 — Money Standardization (✅ IMPLEMENTED 2026-08-14)

> **Status: DONE in code.** POS/repair money is now stored and served as integer
> pesewas across `RepairJob`, `Sale`, `PartOrder`, `RepairOrder`, `PosPayment`,
> `Expense`; every POS/track frontend input converts cedis→pesewas on submit and
> every display divides by 100 (or uses `formatGhs`). Backend + build + 32 tests pass.
>
> **⚠️ ACTION REQUIRED before/at deploy:** run the data migration **once** against
> production (it converts existing rows and is a safe, idempotent no-op on re-run):
> ```
> cd backend-eaz && npm run migrate:pos-money
> ```
> Existing POS data will display 100× too small until this is run. New data written
> after deploying this code is already correct.

---

## Original plan (for reference)


**Goal:** Store all money as integer pesewas everywhere, matching `Part.js` and the project rule *"Money is stored as integer minor units (pesewas). Never store floats for money."*

**Status:** Plan only. No code changed. Nothing runs against any database until you approve.

> ⚠️ **Blast radius is large and asymmetric.** Some money fields are *already* pesewas and must be left alone. If a conversion is applied twice, or a display site is missed, prices show 100× or 0.01× wrong. Read the field table carefully — the risk is entirely in telling the two groups apart.

---

## 1. Field inventory (source of truth)

### Group A — currently **major GHS (float-capable)** → must become **integer pesewas**

| Model | Fields |
|---|---|
| `RepairJob` | `laborCost`, `diagnosisFee`, `depositPaid`, `parts[].priceAtTime`, `parts[].costAtTime` |
| `Sale` | `unitPrice`, `subtotal`, `discount`, `total`, `amountPaid`, `items[].unitPrice`, `items[].subtotal` |
| `PartOrder` | `unitPriceGhs`, `amountGhs` |
| `RepairOrder` | `items[].unitPriceGhs` |
| `PosPayment` | `amount` |
| `Expense` | `amount` |

**Derived (auto-follow, no migration needed but semantics change):** `RepairJob` virtuals `totalPartsAmount`, `totalPartsCost`, `totalAmount`, `balanceDue`, `grossProfit` — these just sum Group-A fields, so once the fields are pesewas the virtuals return pesewas.

### Group B — **already integer pesewas** → DO NOT TOUCH (migration or code)

| Model | Fields |
|---|---|
| `Order` (shop) | `subtotal`, `deliveryFee`, `total`, `items[].price` |
| `Product` | `price` |
| `DeliveryZone` | `fee` |
| `PartOrder` | `subtotalPesewas` |
| `RepairOrder` | `subtotalPesewas`, `shippingFeePesewas`, `totalPesewas` |
| `RepairJob` | `balancePayments[].amountPesewas` |

### Group C — out of scope (separate, internally-consistent GHS convention)

`HostingOrder.amount`, `DomainOrder.price`, `ServiceOrder.depositAmount`. The webhook already multiplies these by 100 at the boundary and they are consistent within their own flows. Leave them exactly as-is.

---

## 2. Backend code sites to change

### 2a. Stop converting pesewas→GHS when snapshotting (remove the `/100`)
- `controllers/posController.js:243-244` — `createJob`: `priceAtTime/costAtTime = Math.round(sellingPrice)/100` → keep `sellingPrice` (already pesewas).
- `controllers/posController.js:526-529` — `updateJob`: same `/100` removal for `priceAtTime`/`costAtTime`.
- `controllers/posController.js:864` — `createRepairOrder`: `unitPriceGhs = sellingPrice/100` → store pesewas (rename intent; see §5 naming note).
- `controllers/posController.js:1814-1815` — `createSale`: `unitPrice`/`subtotal = sellingPrice/100 …` → keep pesewas.

### 2b. Fix the balance/charge math that re-multiplies by 100
- `controllers/posController.js:40-51` — `computeJobBalancePesewas`: currently sums GHS then `* 100`. Once fields are pesewas, **remove the `* 100`** (sum is already pesewas).
- `controllers/posController.js:728-730` — `createPartOrder`: `amountGhs = unitPriceGhs * qty; subtotalPesewas = amountGhs * 100`. After migration `priceAtTime` is pesewas, so `subtotalPesewas = unitPrice * qty` (no `* 100`).
- `controllers/webhookController.js:453,517` — `fulfilRepairOrder`/balance: `PosPayment.amount = totalPesewas/100` → store pesewas (drop `/100`).
- `controllers/webhookController.js:389` — `fulfilPartOrder`: `amount: partOrder.amountGhs` → use the pesewas amount.
- `controllers/posController.js:1938,1997` — `initiateMomoCharge`/`initiateCardCharge`: `amountInPesewas = Math.round(amount * 100)`. If the incoming `amount` is now pesewas, drop the `* 100`. **Verify the request contract with the frontend caller.**

### 2c. Reporting aggregations (values become pesewas; response contract changes)
- `controllers/posController.js:1240-1268` — `getOverview`: `todayPayments`, `allPayments`, `dailyRevenue`, `paymentMethods` all `$sum: '$amount'` (PosPayment) → now pesewas.
- `controllers/posController.js:1277-1307` — `topParts` (`priceAtTime`/`costAtTime`), `topProfitJobs` (`diagnosisFee`/`laborCost`/parts) → pesewas.
- `controllers/posController.js:1335-1347` — `expenseTotal`/`expenseByCategory` (`Expense.amount`) → pesewas.
- `controllers/posController.js:1424-1439` — `getMyOverview`: `Sale.total` sums → pesewas.
- `services/reminderJob.js`, `utils/*Invoice*` / `printReceipt` server side — check any money formatting.

### 2d. `addPayment` input contract
- `controllers/posController.js:1041-1046` — `amount` posted by staff is currently GHS. Decide: keep the **API** in GHS and convert once (`* 100`) on write, or move the frontend to send pesewas. Recommendation: convert at the controller edge so the client keeps entering cedis.

---

## 3. Frontend display sites to change (÷100 or `formatGhs`)

These render Group-A values and currently assume GHS. Each must divide by 100 (prefer the existing `formatGhs` from `lib/shop.js`, which already does ÷100):

- `app/dashboard/pos/jobs/[id]/page.jsx` — job invoice: labour, diagnosis, deposit, parts price, balance.
- `app/dashboard/pos/jobs/new/page.jsx` — inputs/preview (staff enter cedis; convert on submit).
- `app/dashboard/pos/jobs/page.jsx` — list totals.
- `app/dashboard/pos/sell/page.jsx` — Sale line prices/total.
- `app/dashboard/pos/orders/page.jsx` — PartOrder/RepairOrder amounts.
- `app/dashboard/pos/expenses/page.jsx` — Expense amount.
- `app/dashboard/pos/reports/page.jsx` — revenue/profit charts (PosPayment/Sale sums).
- `app/dashboard/pos/dashboard/page.jsx` — `mySalesRevenue`, `myTodaySalesRevenue`, `todayRevenue`, `totalRevenue` (these come from Group-A sums).
- `app/track/[token]/page.jsx` — `priceGhs`, `amountGhs`, balance display (customer-facing — highest visibility).
- `components/pos/Receipt.jsx` + `lib/printReceipt.js` — printed receipts.
- `components/dashboard/customer/CustomerCards.jsx` (RepairCard) — repair totals.

**Must NOT change (already pesewas / already use `formatGhs`):** shop order pages (`dashboard/orders/*`, `dashboard/commerce/orders/*`, `track-order`, `order-confirmation`), `ShopGrid`, `ProductForm`, hosting/domain/email pages. Grep hits there are Group-B/Group-C and are already correct.

---

## 4. Migration script (idempotent, manual-run only)

`src/migratePosMoneyToPesewas.js` (new), added as `npm run migrate:pos-money`.

- Multiplies every Group-A field by 100 and rounds, across `RepairJob`, `Sale`, `PartOrder`, `RepairOrder`, `PosPayment`, `Expense`.
- **Idempotency:** stamp each migrated doc with `moneyUnit: 'pesewas'` (new field) and skip any doc already stamped. Re-running is a no-op. (Alternative: a one-row `migrations` collection keyed by script name — cleaner, no schema noise. Recommend this.)
- **Non-destructive:** dumps a before/after sample and a count; never deletes; can be run against a restored backup first.
- **Never auto-runs.** You run it manually against production during a maintenance window.
- Coordinates with the existing `migrate:part-prices` (already done) — this one covers the *snapshot* models that referenced the old GHS parts.

---

## 5. Naming note (recommended sub-decision)

`PartOrder.unitPriceGhs` / `amountGhs` and `RepairOrder.items[].unitPriceGhs` have "Ghs" in the name but will hold pesewas. Two options:
- **(cheap, recommended)** keep the field names, add a comment that the value is now pesewas. Avoids a second migration/rename.
- **(clean, costlier)** rename to `unitPricePesewas`/`amountPesewas` — requires updating every read site again. Not worth it now.

---

## 6. Tests to add

- Model-level invariant test: after creating jobs/sales/orders via the controllers, assert every Group-A field is an integer (`Number.isInteger`).
- `computeJobBalancePesewas` returns correct pesewas for a job with fractional-cedi parts (e.g. GH₵45.50 part → 4550).
- `createPartOrder`/`createRepairOrder` produce a Paystack `amount` equal to the pesewas total (guard against the double-×100 regression).
- Migration idempotency test: run twice on the same fixture, values unchanged after the first pass.

---

## 7. Risk assessment & recommendation

**Effort:** ~6 backend edit clusters, ~11 frontend files, 1 migration, 4+ tests. Medium-large.

**Risk:** High if rushed — the failure mode is silent 100× price errors on customer-facing pages (`track/[token]`) and staff revenue reports. Mitigated by: the Group-A/B/C table above, doing backend + migration + frontend in one atomic branch, and the invariant tests.

**Recommendation:** This is worth doing, but as its **own focused branch** with a full manual QA pass of the POS money screens and the customer track page — not bundled with unrelated fixes. Two viable scopes:
- **Full (what you approved):** everything above. Best long-term; one convention end-to-end.
- **Minimal alternative (if you want lower risk):** leave stored values as-is, but (a) add the integer-invariant tests only where new code writes money, and (b) document the GHS/pesewas boundary loudly in each model. This removes the *latent* trap without a risky mass migration. Revisit full standardization later.

**Next step:** tell me **"do the full #7"** (I'll implement on a clean pass, backend + frontend + migration + tests together) or **"do the minimal alternative"**, and I'll proceed.
