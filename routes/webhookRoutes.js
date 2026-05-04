const express = require('express');
const { handlePaystackWebhook } = require('../controllers/webhookController');

const router = express.Router();

// Capture raw body for HMAC signature verification before JSON parsing
router.post(
  '/paystack',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    req.rawBody = req.body.toString('utf8');
    req.body = JSON.parse(req.rawBody);
    next();
  },
  handlePaystackWebhook
);

module.exports = router;
