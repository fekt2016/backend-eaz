const errorHandler = (err, req, res, next) => {
  if (err.name === 'ZodError') {
    const fieldErrors = (err.errors || []).map((e) => ({
      field: (e.path || []).join('.'),
      message: e.message,
    }));
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      errors: fieldErrors,
    });
  }

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = { errorHandler };
