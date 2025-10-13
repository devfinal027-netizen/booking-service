const express = require("express");
const router = express.Router();
const newAdmin = require("../controllers/newAdminController");
const { authorize } = require("../middleware/auth");

// Pricing and dashboard endpoints removed from legacy adminController to reduce duplication

module.exports = router;
// --- Additional admin management endpoints (payments endpoints removed) ---

// Subscriptions
router.get("/subscriptions", authorize("admin"), newAdmin.getAllSubscriptions);
router.post("/subscription/:id/approve", authorize("admin"), newAdmin.approveSubscription);
router.post("/subscription/:id/assign-driver", authorize("admin"), newAdmin.assignDriverToSubscription);
router.put("/subscription/:id", authorize("admin"), newAdmin.updateSubscriptionByAdmin);
router.delete("/subscription/:id", authorize("admin"), newAdmin.deleteSubscriptionByAdmin);
router.post(
  "/subscription/passenger/:passengerId/assign-driver",
  authorize("admin"),
  async (req, res, next) => {
    req.params.id = req.params.passengerId;
    req.body = { ...(req.body || {}), passenger_id: req.params.passengerId };
    return newAdmin.assignDriverToSubscription(req, res, next);
  }
);

// Trips
router.get("/trips", authorize("admin"), newAdmin.getAllTrips);
router.get("/passenger/:id/trips", authorize("admin"), newAdmin.getTripsByPassenger);
router.get("/driver/:id/trips", authorize("admin"), newAdmin.getTripsByDriver);

// Drivers (external service backed)
router.get("/drivers", authorize("admin"), newAdmin.getDrivers);
router.get("/driver/:id", authorize("admin"), newAdmin.getDriverDetail);