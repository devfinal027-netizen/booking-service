const express = require("express");
const router = express.Router();
const { authorize } = require("../../middleware/auth");
const controller = require("../../controllers/newSubscriptionController");
const { createUploader } = require("../../utils/multerUploader");

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

function mapFirstFile(req, _res, next) {
  if (!req.file && Array.isArray(req.files) && req.files.length > 0) {
    req.file = req.files[0];
  }
  next();
}

// Passenger-initiated payments for subscriptions (SantimPay direct)
router.post(
  "/subscription/:id",
  authorize("admin", "passenger"),
  paymentUploader.any(),
  mapFirstFile,
  controller.processPayment
);

// Webhook for gateway to update subscription payment status
router.post("/webhook", controller.subscriptionPaymentWebhook);

module.exports = router;

