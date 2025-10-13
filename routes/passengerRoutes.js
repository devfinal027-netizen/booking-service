const express = require("express");
const router = express.Router();
const controller = require("../controllers/passengerController");
const { authorize } = require("../middleware/auth");
const { getPassengerSubscriptions } = require("../controllers/newSubscriptionController");

// Passenger-specific routes
// Convenience alias: current passenger
// Replace passenger driver lookup with subscription-based lookup
router.get("/subscription/:subscriptionId/driver", authorize("admin", "passenger"), controller.getAssignedDriverBySubscription);
router.get("/:id/trips", authorize("admin", "passenger"), controller.getTripHistory);
router.get("/:id/subscriptions", authorize("admin", "passenger"), getPassengerSubscriptions);

// Trip confirmation routes
router.patch("/trip/:id/pickup", authorize("admin", "passenger"), controller.confirmPickup);
router.patch("/trip/:id/end", authorize("admin", "passenger"), controller.confirmTripEnd);

// Subscription pricing endpoint removed; price is calculated during creation

module.exports = router;