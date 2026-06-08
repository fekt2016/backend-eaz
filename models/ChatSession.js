const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role:    { type: String, enum: ['user', 'bot', 'admin'], required: true },
  content: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
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
  humanRequested:  { type: Boolean, default: false }, // user requested live chat
  humanAccepted:   { type: Boolean, default: false }, // admin accepted the request
  humanAcceptedAt: { type: Date },
  // Last activity
  lastActivity: { type: Date, default: Date.now },
}, { timestamps: true });

chatSessionSchema.index({ lastActivity: -1 });
chatSessionSchema.index({ resolved: 1 });
chatSessionSchema.index({ humanRequested: 1 });
chatSessionSchema.index({ humanAccepted: 1 });

module.exports = mongoose.model('ChatSession', chatSessionSchema);
