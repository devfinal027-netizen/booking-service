const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/admin.controller');
const { authorize } = require('../../middleware/auth');

router.get('/', authorize('admin','superadmin'), ctrl.list);
router.get('/:id', authorize('admin','superadmin'), ctrl.get);

// Keep create/update/remove for local domain-only if needed
router.post('/', authorize('superadmin'), ctrl.create);
router.put('/:id', authorize('superadmin'), ctrl.update);
router.delete('/:id', authorize('superadmin'), ctrl.remove);

// Active drivers with pagination
router.get('/drivers/active/list', authorize('admin','superadmin'), async (req, res) => {
  try {
    const { Driver } = require('../../models/userModels');
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '20', 10)));
    const skip = (page - 1) * limit;
    const q = { available: true };
    if (req.query.vehicleType) q.vehicleType = String(req.query.vehicleType);
    const [rows, total] = await Promise.all([
      Driver.find(q)
        .select({ _id: 1, name: 1, phone: 1, email: 1, vehicleType: 1, carName: 1, carModel: 1, carPlate: 1, carColor: 1, rating: 1, updatedAt: 1 })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Driver.countDocuments(q)
    ]);
    return res.json({
      page,
      limit,
      total,
      data: rows.map(d => ({
        id: String(d._id),
        name: d.name,
        phone: d.phone,
        email: d.email,
        vehicleType: d.vehicleType,
        carName: d.carName,
        carModel: d.carModel,
        carPlate: d.carPlate,
        carColor: d.carColor,
        rating: d.rating,
        updatedAt: d.updatedAt
      }))
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;


