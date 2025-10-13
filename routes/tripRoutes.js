const express = require("express");
const router = express.Router();
const controller = require("../controllers/tripController");
const { authorize } = require("../middleware/auth");

// Trip management routes (passenger-driven workflow only)
router.get("/", authorize("passenger"), controller.listTrips);
router.post("/pickup", authorize("passenger"), controller.createTripOnPickup);
// Removed manual trip creation and start for drivers/admins to enforce passenger-driven flow
router.get("/:id", authorize("passenger"), controller.getTripDetails);
// Only passenger-driven flow: create on pickup and confirm dropoff
// router.patch("/:id/complete", authorize("passenger"), controller.completeTrip);
// router.patch("/:id/pickup", authorize("passenger"), controller.confirmPickup);
router.patch("/:id/dropoff", authorize("passenger"), controller.confirmDropoff);

module.exports = router;