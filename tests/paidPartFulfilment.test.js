const Part = require("../models/Part");
const RepairJob = require("../models/RepairJob");
const PosCustomer = require("../models/PosCustomer");
const { applyPaidPartToJob } = require("../controllers/webhookController");

async function seedJobWithPart(partOverrides = {}) {
  const customer = await PosCustomer.create({ phone: "0244000000", name: "C" });
  const part = await Part.create({
    name: "iPhone 13 Screen", category: "Screen", isRetail: true, quantity: 5,
    costPrice: 30000, sellingPrice: 55000, ...partOverrides,
  });
  const job = await RepairJob.create({
    customer: customer._id, faultDescription: "Cracked screen", parts: [],
  });
  return { part, job };
}

describe("applyPaidPartToJob — online part fulfilment (#9 cost, #10 reserve)", () => {
  it("snapshots the real Part cost (not the sale price) and reserves stock once", async () => {
    const { part, job } = await seedJobWithPart();

    await applyPaidPartToJob(job, {
      part: part._id, partName: part.name, quantity: 2, unitPricePesewas: 55000,
    });
    await job.save({ validateBeforeSave: false });

    const line = job.parts[0];
    expect(line.priceAtTime).toBe(55000);     // paid selling price
    expect(line.costAtTime).toBe(30000);      // real Part.costPrice, NOT 55000
    expect(line.stockDeducted).toBe(true);

    const freshPart = await Part.findById(part._id);
    expect(freshPart.quantity).toBe(3);       // 5 − 2 reserved
  });

  it("does not double-deduct when the same order is applied twice", async () => {
    const { part, job } = await seedJobWithPart();

    const item = { part: part._id, partName: part.name, quantity: 2, unitPricePesewas: 55000 };
    await applyPaidPartToJob(job, item);
    await applyPaidPartToJob(job, item); // e.g. duplicate/replayed webhook
    await job.save({ validateBeforeSave: false });

    expect(job.parts).toHaveLength(1);
    const freshPart = await Part.findById(part._id);
    expect(freshPart.quantity).toBe(3); // still only decremented once
  });

  it("does not attach an inventory part to a same-named custom line", async () => {
    const { part, job } = await seedJobWithPart();
    // A pre-existing custom line with the same name but no inventory ref.
    job.parts.push({ name: part.name, quantity: 1, priceAtTime: 40000, costAtTime: 0 });
    await job.save();

    await applyPaidPartToJob(job, {
      part: part._id, partName: part.name, quantity: 2, unitPricePesewas: 55000,
    });
    await job.save({ validateBeforeSave: false });

    const customLine = job.parts.find((p) => !p.part);
    const invLine = job.parts.find((p) => p.part && p.part.toString() === part._id.toString());
    expect(customLine.stockDeducted).toBe(false);       // untouched
    expect(invLine).toBeTruthy();                        // new inventory line added
    expect(invLine.stockDeducted).toBe(true);
    expect((await Part.findById(part._id)).quantity).toBe(3); // 5 − 2, deducted once
  });

  it("never drives stock negative unless the Part allows it", async () => {
    const { part, job } = await seedJobWithPart({ quantity: 1 });

    await applyPaidPartToJob(job, {
      part: part._id, partName: part.name, quantity: 4, unitPricePesewas: 55000,
    });
    await job.save({ validateBeforeSave: false });

    const freshPart = await Part.findById(part._id);
    expect(freshPart.quantity).toBe(1);          // guarded — unchanged
    expect(job.parts[0].stockDeducted).toBe(true); // still flagged so staff won't retry
  });
});
