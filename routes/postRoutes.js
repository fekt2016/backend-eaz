const express = require('express');
const { getPosts, getAllPosts, getPost, getPostById, createPost, updatePost, deletePost } = require('../controllers/postController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Admin (must be declared BEFORE /:slug so Express doesn't match "admin" as a slug)
router.get('/admin/all',       protect, restrictTo('admin'), getAllPosts);
router.get('/admin/:id',       protect, restrictTo('admin'), getPostById);
router.post('/',               protect, restrictTo('admin'), createPost);
router.patch('/:id',           protect, restrictTo('admin'), updatePost);
router.delete('/:id',          protect, restrictTo('admin'), deletePost);

// Public
router.get('/',         getPosts);
router.get('/:slug',    getPost);

module.exports = router;
