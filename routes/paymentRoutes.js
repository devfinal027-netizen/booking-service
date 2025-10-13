const express = require("express");
const router = express.Router();
const { authorize } = require("../middleware/auth");
const controller = require("../controllers/paymentController");
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

// Admin: full access, Passenger: create & read their own
router.post(
  "/",
  authorize("admin", "passenger"),
  paymentUploader.any(),
  mapFirstFile,
  controller.createPayment
);

router.get("/", authorize("admin", "passenger"), controller.getPayments);

// Admin approval routes (define before parameterized :id routes to avoid conflicts)
router.get("/pending", authorize("admin"), controller.getPendingPayments);
router.patch("/:id/approve", authorize("admin"), controller.approvePayment);
router.patch("/:id/reject", authorize("admin"), controller.rejectPayment);

router.get("/:id", authorize("admin", "passenger"), controller.getPayment);

router.put(
  "/:id",
  authorize("admin"),
  paymentUploader.any(),
  mapFirstFile,
  controller.updatePayment
);

router.delete("/:id", authorize("admin"), controller.deletePayment);

module.exports = router;
