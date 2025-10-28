const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../../middleware/auth');
const ctrl = require('../../controllers/paymentController');
const multer = require('multer');
const path = require('path');

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

// All endpoints in this router are behind authenticate (mounted after authenticate in v1 index)

// Create
router.post('/', authorize('admin'), upload.single('logo'), (req, res, next) => {
  if (req.file && !req.body.logo) {
    const base = process.env.PUBLIC_BASE_URL || '';
    const rel = `/uploads/payment-options/${req.file.filename}`;
    req.body.logo = base ? `${base}${rel}` : rel;
  }
  return ctrl.createPaymentOption(req, res, next);
});

// List all (drivers/admin/staff/superadmin)
router.get('/', authorize('driver','admin','staff','superadmin'), ctrl.listPaymentOptions);

// Get one (drivers/admin/staff/superadmin)
router.get('/:id', authorize('driver','admin','staff','superadmin'), ctrl.getPaymentOption);

// Update
router.put('/:id', authorize('admin'), upload.single('logo'), (req, res, next) => {
  if (req.file) {
    const base = process.env.PUBLIC_BASE_URL || '';
    const rel = `/uploads/payment-options/${req.file.filename}`;
    req.body.logo = base ? `${base}${rel}` : rel;
  }
  return ctrl.updatePaymentOption(req, res, next);
});

// Delete
router.delete('/:id', authorize('admin'), ctrl.deletePaymentOption);

module.exports = router;

