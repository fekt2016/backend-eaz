const Project = require('../models/Project');
const { sanitizeText, sanitizeName } = require('../utils/sanitize');

/**
 * Get all projects
 */
const getProjects = async (req, res, next) => {
  try {
    const { category, featured } = req.query;
    const query = {};

    if (category) {
      query.category = category;
    }

    if (featured === 'true') {
      query.featured = true;
    }

    const projects = await Project.find(query).sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: projects.length,
      data: projects
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single project by ID
 */
const getProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    
    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    res.status(200).json({
      success: true,
      data: project
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create project (for admin)
 */
const createProject = async (req, res, next) => {
  try {
    const title       = sanitizeName(req.body.title, 200);
    const description = sanitizeText(req.body.description, 2000);
    const image       = sanitizeText(req.body.image, 500);
    const category    = sanitizeName(req.body.category, 100);
    const link        = sanitizeText(req.body.link, 500);
    const { featured } = req.body;

    if (!title || !description || !image) {
      return res.status(400).json({
        success: false,
        error: 'Title, description, and image are required'
      });
    }

    const project = await Project.create({
      title,
      description,
      image,
      category: category || 'Web Development',
      link,
      featured: featured || false
    });

    res.status(201).json({
      success: true,
      data: project
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update project (for admin)
 */
const updateProject = async (req, res, next) => {
  try {
    // Sanitize only the fields that may be supplied; omit keys that weren't sent
    const updates = {};
    if (req.body.title       !== undefined) updates.title       = sanitizeName(req.body.title, 200);
    if (req.body.description !== undefined) updates.description = sanitizeText(req.body.description, 2000);
    if (req.body.image       !== undefined) updates.image       = sanitizeText(req.body.image, 500);
    if (req.body.category    !== undefined) updates.category    = sanitizeName(req.body.category, 100);
    if (req.body.link        !== undefined) updates.link        = sanitizeText(req.body.link, 500);
    if (req.body.featured    !== undefined) updates.featured    = Boolean(req.body.featured);

    const project = await Project.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    res.status(200).json({
      success: true,
      data: project
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete project (for admin)
 */
const deleteProject = async (req, res, next) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id);

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {}
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
};

