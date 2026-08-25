const mongoose = require('mongoose');

// Small shared collection of monotonic counters, keyed by a caller-chosen string
// (e.g. 'sale:202608'). It exists because document numbers derived from
// countDocuments() are read-modify-write: two concurrent writers read the same
// count, generate the same number, and the unique index kills one of them (T47).
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String },
    seq: { type: Number, default: 0, min: 0 },
  },
  { versionKey: false }
);

// Create the row if it isn't there yet. Call this OUTSIDE a transaction: two
// transactions upserting the same missing _id race into an E11000, which
// withTransaction will NOT retry because a duplicate-key error carries no
// TransientTransactionError label. Once the row exists, concurrent $inc's inside
// transactions collide as WriteConflict instead — that one IS labelled
// transient, so withTransaction retries it on its own.
counterSchema.statics.ensure = async function (key, startAt = 0) {
  try {
    await this.updateOne({ _id: key }, { $setOnInsert: { seq: startAt } }, { upsert: true });
  } catch (err) {
    // Lost the insert race — the row now exists, which is all we wanted.
    if (err?.code !== 11000) throw err;
  }
};

// Hand out the next value atomically. Passing `session` joins an open
// transaction, so a sale that aborts rolls its number back instead of burning it.
counterSchema.statics.next = async function (key, session) {
  const doc = await this.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, ...(session ? { session } : {}) }
  );
  return doc.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
