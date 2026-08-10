const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
  },
  phone: {
    type: String,
    trim: true,
  },
  businessName: {
    type: String,
    trim: true,
  },
  subject: {
    type: String,
    trim: true,
  },
  type: {
    type: String,
    enum: ['general', 'consultation', 'hosting-enquiry', 'seo-audit', 'domain', 'other'],
    default: 'general',
  },
  service: {
    type: String,
    trim: true,
  },
  plan: {
    type: String,
    trim: true,
  },
  message: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ['new', 'read', 'replied', 'archived'],
    default: 'new',
  },
  adminNote: {
    type: String,
    trim: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Contact', contactSchema);
