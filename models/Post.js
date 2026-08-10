const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  excerpt: {
    type: String,
    required: [true, 'Excerpt is required'],
    trim: true,
  },
  content: {
    type: String,
    required: [true, 'Content is required'],
  },
  category: {
    type: String,
    required: true,
    enum: ['SEO', 'Web Design', 'Case Study', 'Social Media', 'Branding', 'Phone Repair', 'Paid Advertising', 'Email Marketing', 'General'],
    default: 'General',
  },
  author: {
    type: String,
    default: 'EazWorld Team',
    trim: true,
  },
  readTime: {
    type: String,
    default: '5 min read',
  },
  featured: {
    type: Boolean,
    default: false,
  },
  published: {
    type: Boolean,
    default: false,
  },
  publishedAt: {
    type: Date,
  },
}, {
  timestamps: true,
});

// slug index is created automatically by unique:true on the field
postSchema.index({ published: 1, publishedAt: -1 });
postSchema.index({ category: 1, published: 1 });

// Auto-set publishedAt when published
postSchema.pre('save', function (next) {
  if (this.isModified('published') && this.published && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  next();
});

module.exports = mongoose.model('Post', postSchema);
