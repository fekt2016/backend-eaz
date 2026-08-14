# PR — POS money in pesewas, stock/inventory fixes, and review hardening

## Summary
Backend hardening from a full codebase review: standardize the POS/repair domain on **integer pesewas**, fix inventory/stock and catalogue issues, tighten order-status handling, and add test coverage.

## Changes

### Money → integer pesewas
- `RepairJob`, `Sale`, `PartOrder`, `RepairOrder`, `PosPayment`, `Expense` now **store and serve integer pesewas**, matching `Part` and the shop `Order` (no more decimal-cedis floats in money fields).
- Adjusted `computeJobBalance`, `createPartOrder`/`createRepairOrder`/`createSale`, MoMo/card charge, and webhook fulfilment amounts accordingly.
- **Migration:** `npm run migrate:pos-money` — idempotent (stamps `moneyUnit`), safe to re-run.

### Inventory / stock
- `deductPartStock` util: guarded decrement — **never oversells** unless the `Part` sets `allowNegativeStock` (previously unenforced).
- Online part/repair orders **reserve stock on payment**, flagged per job-part line so the staff-side deduction never double-counts.
- Snapshot the real `Part.costPrice` on fulfilment (not the sale price) → **profit reports are now accurate**.

### Catalogue / orders
- Retail parts (`isRetail`) resolve at `/products/part-<id>` → their `/shop/part-<id>` detail page works instead of 404ing.
- Partial-unique SKU index on `Part` and `Product`, plus a read-only pre-flight: `npm run check:duplicate-skus`.
- `getProducts` merges products + retail parts and **sorts/paginates in the database** (`$unionWith` + `$facet`) instead of loading everything into memory.
- **Forward-only order status** transitions (rank-based: allows forward skips + cancel, blocks backward/terminal moves).
- Escape user regex input in POS inventory/jobs/customer search.
- Remove the duplicate `Order.trackingNumber` index.

## Tests
+28 backend tests (stock guard, paid-part fulfilment, money migration, part detail, merged listing, status flow, shop fulfilment, parts search). **Full suite green (49 tests).**

## ⚠️ Deploy steps — run once, in order
1. `npm run check:duplicate-skus` (must be clean before the unique SKU index builds)
2. `npm run migrate:pos-money` (idempotent)
3. Set prod env: strong `JWT_SECRET`, `FRONTEND_URL`, `NEXT_PUBLIC_API_URL`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
