const mongoose = require("mongoose");
const { PIPELINES } = require("../src/migratePosMoneyToPesewas");

// Applies a migration pipeline exactly like the script does (guarded so it only
// touches un-migrated docs), against the in-memory DB.
async function migrate(collName) {
  const coll = mongoose.connection.db.collection(collName);
  return coll.updateMany({ moneyUnit: { $ne: "pesewas" } }, PIPELINES[collName]);
}

describe("migratePosMoneyToPesewas", () => {
  it("converts repair-job money (incl. fractional cedis) to integer pesewas", async () => {
    const jobs = mongoose.connection.db.collection("repairjobs");
    await jobs.insertOne({
      laborCost: 50, // GH₵50
      diagnosisFee: 20,
      depositPaid: 10,
      parts: [{ name: "Screen", quantity: 2, priceAtTime: 45.5, costAtTime: 30 }],
      // already-pesewas field must be left untouched
      balancePayments: [{ reference: "x", amountPesewas: 500, status: "paid" }],
    });

    await migrate("repairjobs");
    const doc = await jobs.findOne({});

    expect(doc.laborCost).toBe(5000);
    expect(doc.diagnosisFee).toBe(2000);
    expect(doc.depositPaid).toBe(1000);
    expect(doc.parts[0].priceAtTime).toBe(4550); // 45.5 → integer pesewas
    expect(doc.parts[0].costAtTime).toBe(3000);
    expect(doc.balancePayments[0].amountPesewas).toBe(500); // untouched
    expect(doc.moneyUnit).toBe("pesewas");
    [doc.laborCost, doc.diagnosisFee, doc.depositPaid, doc.parts[0].priceAtTime].forEach((v) =>
      expect(Number.isInteger(v)).toBe(true),
    );
  });

  it("is idempotent — a second run changes nothing", async () => {
    const jobs = mongoose.connection.db.collection("repairjobs");
    await jobs.insertOne({ laborCost: 12, diagnosisFee: 0, depositPaid: 0, parts: [] });

    const first = await migrate("repairjobs");
    expect(first.modifiedCount).toBe(1);

    const second = await migrate("repairjobs");
    expect(second.modifiedCount).toBe(0); // already stamped moneyUnit: pesewas

    const doc = await jobs.findOne({ laborCost: 1200 });
    expect(doc.laborCost).toBe(1200); // not multiplied twice
  });

  it("converts part orders but leaves *Pesewas fields alone", async () => {
    const partorders = mongoose.connection.db.collection("partorders");
    await partorders.insertOne({
      partName: "Battery",
      quantity: 2,
      unitPriceGhs: 45.5,
      amountGhs: 91,
      subtotalPesewas: 9100, // already pesewas — must not change
    });

    await migrate("partorders");
    const doc = await partorders.findOne({});

    expect(doc.unitPriceGhs).toBe(4550);
    expect(doc.amountGhs).toBe(9100);
    expect(doc.subtotalPesewas).toBe(9100); // untouched
    expect(doc.moneyUnit).toBe("pesewas");
  });

  it("converts pos payments and expenses", async () => {
    const pospayments = mongoose.connection.db.collection("pospayments");
    const expenses = mongoose.connection.db.collection("expenses");
    await pospayments.insertOne({ amount: 75 });
    await expenses.insertOne({ amount: 120.25 });

    await migrate("pospayments");
    await migrate("expenses");

    expect((await pospayments.findOne({})).amount).toBe(7500);
    expect((await expenses.findOne({})).amount).toBe(12025);
  });
});
