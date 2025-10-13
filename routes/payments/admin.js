const express = require("express");
const router = express.Router();
const { authorize } = require("../../middleware/auth");
const controller = require("../../controllers/paymentController");

// Admin-specific payment management endpoints
router.get("/pending", authorize("admin"), controller.getPendingPayments);
router.patch("/:id/approve", authorize("admin"), controller.approvePayment);
router.patch("/:id/reject", authorize("admin"), controller.rejectPayment);

module.exports = router;

