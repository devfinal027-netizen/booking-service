const express = require("express");
const router = express.Router();
const controller = require("../controllers/newSubscriptionController");
const { authorize } = require("../middleware/auth");
const { createUploader } = require("../utils/multerUploader");

// Configure multer for payment receipts
const paymentUploader = createUploader({
  subfolder: "payments",
  allowedMimeTypes: [
    "image/jpeg",
    "image/jpg", 
    "image/png",
    "image/gif",
    "image/webp",
  ],
  maxFileSizeMB: 5,
});

// Helper to map first uploaded file (from any field name) to req.file
function mapFirstFile(req, _res, next) {
  if (!req.file && Array.isArray(req.files) && req.files.length > 0) {
    req.file = req.files[0];
  }
  next();
}

// Subscription creation and payment routes
router.post("/create", authorize("passenger"), controller.createSubscription);
router.post("/:id/payment", authorize("admin", "passenger"), paymentUploader.any(), mapFirstFile, controller.processPayment);
router.post("/payment/webhook", controller.subscriptionPaymentWebhook);

// Admin routes for pending items
router.get("/pending", authorize("admin", "superadmin"), controller.getPendingSubscriptions);
router.get("/passenger/:id/subscriptions", authorize("admin", "passenger"), controller.getPassengerSubscriptions);

module.exports = router;