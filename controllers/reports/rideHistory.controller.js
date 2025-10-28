const base = require('../analytics.controller');

exports.getRideHistory = async (req, res) => base.getRideHistory(req, res);
exports.getTripHistoryByUserId = async (req, res) => base.getTripHistoryByUserId(req, res);


