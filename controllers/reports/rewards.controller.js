const base = require('../analytics.controller');

exports.getPassengerRewards = async (req, res) => base.getPassengerRewards(req, res);
exports.getDriverRewards = async (req, res) => base.getDriverRewards(req, res);
exports.postRewardsConfig = async (req, res) => {
  // Delegate to inline handler in analytics.routes via base controller where logic lives
  return require('../analytics.controller');
};


