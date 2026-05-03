const express = require('express');
const {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
} = require('../controllers/projectController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

router.get('/', getProjects);
router.get('/:id', getProject);
router.post('/', protect, restrictTo('admin'), createProject);
router.put('/:id', protect, restrictTo('admin'), updateProject);
router.delete('/:id', protect, restrictTo('admin'), deleteProject);

module.exports = router;
