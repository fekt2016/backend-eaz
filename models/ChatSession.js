const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role:    { type: String, enum: ['user', 'bot', 'admin'], required: true },
  content: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
  // T69 — who actually sent an `admin` message. Added ALONGSIDE `role`, not in
  // place of it: every existing renderer switches on `role === 'admin'`, and a
  // pre-T69 message simply has no sender (shown as "Unattributed" in metrics).
  // Never sent to the customer widget — getMessages projects these away.
  senderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  senderName: { type: String, trim: true, default: '' },
});

const chatSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true }, // unique:true already creates index
  messages:  [messageSchema],
  // Optional — captured during conversation
  name:  { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  // Status
  resolved:        { type: Boolean, default: false },
  resolvedAt:      { type: Date },                    // T69 — set when resolved flips true, cleared on reopen
  humanRequested:  { type: Boolean, default: false }, // user requested live chat
  humanAccepted:   { type: Boolean, default: false }, // admin accepted the request
  humanAcceptedAt: { type: Date },                    // when the live chat connected — the clock first-response time is measured from
  // T69 — ownership. Who is answering this conversation, so two agents don't
  // silently double-reply and per-staff metrics have something to group by.
  // Distinct from humanAcceptedAt: a session can be claimed (supervisor takes
  // over an already-live chat) without the customer's wait clock restarting.
  acceptedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  acceptedByName: { type: String, trim: true, default: '' },
  acceptedAt:     { type: Date },
  // T69 phase 4 — CSAT. Left by the customer after the chat closes, so it's the
  // one quality signal that isn't just speed. Credited to whoever owned the
  // session (`acceptedBy`) at the time it was rated.
  rating:        { type: Number, min: 1, max: 5 },
  ratingComment: { type: String, trim: true, default: '' },
  ratedAt:       { type: Date },
  // Last activity
  lastActivity: { type: Date, default: Date.now },
}, { timestamps: true });

chatSessionSchema.index({ lastActivity: -1 });
chatSessionSchema.index({ resolved: 1 });
chatSessionSchema.index({ humanRequested: 1 });
chatSessionSchema.index({ humanAccepted: 1 });
// T69 — the metrics endpoint filters sessions by creation date.
chatSessionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ChatSession', chatSessionSchema);
