const express = require('express');
const router = express.Router();

// Internal authentication endpoints have been removed.
// Use external identity provider to obtain JWTs, then call protected APIs with Bearer token.

router.get('/health', (req, res) => {
  res.json({ status: 'ok', auth: 'external' });
});

module.exports = router;

