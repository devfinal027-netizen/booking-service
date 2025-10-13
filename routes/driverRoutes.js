const express = require("express");
const router = express.Router();
const controller = require("../controllers/newDriverController");
const { authorize } = require("../middleware/auth");

// Driver-specific routes (unified)
router.get("/:id/passengers", authorize("admin", "driver"), controller.getDriverPassengers);
router.get("/:id/schedule", authorize("admin", "driver"), controller.getDriverSchedule);
router.get("/:id/triphistory", authorize("admin", "driver"), controller.getDriverTripHistory);
router.get("/:id/earnings", authorize("admin", "driver"), controller.getDriverEarnings);
router.post("/:id/trip/:tripId/notify", authorize("admin", "driver"), controller.notifyPassenger);

module.exports = router;