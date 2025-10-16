module.exports = {
  ...require('./reports/periodicReports.controller'),
  ...require('./reports/dashboardReport.controller'),
  ...require('./reports/driverEarnings.controller'),
  ...require('./reports/financeOverview.controller'),
  ...require('./reports/rideHistory.controller'),
  ...require('./reports/rewards.controller'),
};
