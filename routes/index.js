const express = require('express');
const router = express.Router();
const requestLogger = require('../middleware/requestLogger');

router.use(requestLogger);
router.use('/', require('./v1'));

module.exports = router;
