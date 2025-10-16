const express = require("express");
const router = express.Router();
const { authenticate, authorize } = require("../../middleware/auth");
const multer = require('multer');
const path = require('path');

// Multer config for payment option logo uploads and multipart parsing
const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, path.join(process.cwd(), 'uploads', 'payment-options'));
  },
  filename: function (_req, file, cb) {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${ts}-${safe}`);
  }
});
const upload = multer({ storage });

router.use("/auth", require("./auth.routes"));
// Public webhooks (no auth) MUST be mounted before authenticate
router.use(
  "/wallet",
  (() => {
    const express = require("express");
    const r = express.Router();
    const ctrl = require("../../controllers/wallet.controller");
    // public webhook only
    r.post("/webhook", ctrl.webhook);
    return r;
  })()
);

// Everything below requires auth
router.use(authenticate);

router.use("/bookings", require("./booking.routes"));
router.use(
  "/assignments",
  authorize("admin", "staff"),
  require("./assignment.routes")
);
router.use("/trips", require("./trip.routes"));
router.use("/live", require("./live.routes"));
router.use("/pricing", authorize("admin"), require("./pricing.routes"));
router.use("/driver-pricing", require("./driverPricing.routes"));
// Admin user management is handled by external service
router.use("/drivers", require("./driver.routes"));
// Payment options simple router
router.get('/payment-options', async (req, res) => {
  try {
    const ctrl = require('../../controllers/driver.controller');
    return await ctrl.listPaymentOptions(req, res);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});
router.post('/payment-options', authorize('admin','superadmin'), upload.single('logo'), async (req, res) => {
  try {
    // If a logo file was uploaded but logo URL not set, construct URL
    if (req.file && !req.body.logo) {
      const base = process.env.PUBLIC_BASE_URL || '';
      const rel = `/uploads/payment-options/${req.file.filename}`;
      req.body.logo = base ? `${base}${rel}` : rel;
    }
    const { create } = require('../../controllers/paymentOption.controller');
    return await create(req, res);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});
router.post('/driver/payment-preference', async (req, res) => {
  try {
    const ctrl = require('../../controllers/driver.controller');
    return await ctrl.setPaymentPreference(req, res);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
});
router.use("/mapping", require("./mapping.routes"));
router.use("/passengers", require("./passenger.routes"));
router.use("/analytics", require("./analytics.routes"));
router.use("/wallet", require("./wallet.routes"));
router.use("/admin", require("./admin.routes"));

module.exports = router;
