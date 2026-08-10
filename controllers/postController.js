const Post = require('../models/Post');
const { sanitizeText, sanitizeMessage, sanitizeName } = require('../utils/sanitize');

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function estimateReadTime(content) {
  const words = content.trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${minutes} min read`;
}

/** GET /api/v1/posts — published posts (public) */
const getPosts = async (req, res, next) => {
  try {
    const filter = { published: true };
    if (req.query.category) filter.category = req.query.category;
    const posts = await Post.find(filter).sort({ publishedAt: -1 }).select('-content');
    res.json({ success: true, count: posts.length, data: posts });
  } catch (err) { next(err); }
};

/** GET /api/v1/posts/all — all posts (admin) */
const getAllPosts = async (req, res, next) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 }).select('-content');
    res.json({ success: true, count: posts.length, data: posts });
  } catch (err) { next(err); }
};

/** GET /api/v1/posts/:slug — single post (public, published only) */
const getPost = async (req, res, next) => {
  try {
    const post = await Post.findOne({ slug: req.params.slug, published: true });
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    res.json({ success: true, data: post });
  } catch (err) { next(err); }
};

/** GET /api/v1/posts/:id/admin — single post for editing (admin) */
const getPostById = async (req, res, next) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    res.json({ success: true, data: post });
  } catch (err) { next(err); }
};

/** POST /api/v1/posts — create post (admin) */
const createPost = async (req, res, next) => {
  try {
    const title    = sanitizeText(req.body.title, 200);
    const excerpt  = sanitizeText(req.body.excerpt, 500);
    const content  = sanitizeMessage(req.body.content, 50000);
    const category = sanitizeText(req.body.category, 100);
    const author   = sanitizeName(req.body.author, 100);
    const { featured, published } = req.body;
    if (!title || !excerpt || !content || !category) {
      return res.status(400).json({ success: false, error: 'title, excerpt, content and category are required' });
    }
    let slug = generateSlug(title);
    // Ensure unique slug
    const exists = await Post.findOne({ slug });
    if (exists) slug = `${slug}-${Date.now()}`;

    const post = await Post.create({
      title, excerpt, content, category,
      slug,
      author:    author    || 'EazWorld Team',
      readTime:  estimateReadTime(content),
      featured:  featured  || false,
      published: published || false,
    });
    res.status(201).json({ success: true, data: post });
  } catch (err) { next(err); }
};

/** PATCH /api/v1/posts/:id — update post (admin) */
const updatePost = async (req, res, next) => {
  try {
    const { featured, published } = req.body;
    const title    = req.body.title    !== undefined ? sanitizeText(req.body.title, 200)         : undefined;
    const excerpt  = req.body.excerpt  !== undefined ? sanitizeText(req.body.excerpt, 500)        : undefined;
    const content  = req.body.content  !== undefined ? sanitizeMessage(req.body.content, 50000)   : undefined;
    const category = req.body.category !== undefined ? sanitizeText(req.body.category, 100)       : undefined;
    const author   = req.body.author   !== undefined ? sanitizeName(req.body.author, 100)         : undefined;
    const update = {};
    if (title     !== undefined) { update.title    = title;    update.slug = generateSlug(title); }
    if (excerpt   !== undefined)   update.excerpt   = excerpt;
    if (content   !== undefined) { update.content  = content;  update.readTime = estimateReadTime(content); }
    if (category  !== undefined)   update.category  = category;
    if (author    !== undefined)   update.author    = author;
    if (featured  !== undefined)   update.featured  = featured;
    if (published !== undefined)   update.published = published;

    const post = await Post.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    res.json({ success: true, data: post });
  } catch (err) { next(err); }
};

/** DELETE /api/v1/posts/:id (admin) */
const deletePost = async (req, res, next) => {
  try {
    const post = await Post.findByIdAndDelete(req.params.id);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    res.json({ success: true, data: {} });
  } catch (err) { next(err); }
};

module.exports = { getPosts, getAllPosts, getPost, getPostById, createPost, updatePost, deletePost };
