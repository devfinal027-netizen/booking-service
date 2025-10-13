const { RideSchedule } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { getDriverById } = require("../utils/userService");

// CREATE
exports.createRideSchedule = asyncHandler(async (req, res) => {
  const rideSchedule = await RideSchedule.create(req.body);
  res.status(201).json({ success: true, data: rideSchedule });
});

// READ all - Admin sees all, Driver sees only their assigned schedules
exports.getRideSchedules = asyncHandler(async (req, res) => {
  let whereClause = {};

  if (req.user.type === "driver") {
    whereClause.driver_id = req.user.id;
  }

  const schedules = await RideSchedule.findAll({
    where: whereClause,
    include: [{ association: "contract" }],
  });
  const list = schedules.map(s => s.toJSON());
  const uniqueDriverIds = [...new Set(list.map(s => s.driver_id).filter(Boolean))];
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const driverInfoMap = new Map();
  await Promise.all(uniqueDriverIds.map(async (did) => {
    try {
      const info = await getDriverById(did, authHeader);
      if (info) driverInfoMap.set(did, info);
    } catch (_) {}
  }));

  const enriched = list.map(s => {
    const info = driverInfoMap.get(s.driver_id);
    if (!info) return s;
    return {
      ...s,
      driver_name: info.name || null,
      driver_phone: info.phone || null,
      driver_email: info.email || null,
    };
  });
  res.json({ success: true, data: enriched });
});

// READ one - Admin sees all, Driver sees only their assigned schedules
exports.getRideSchedule = asyncHandler(async (req, res) => {
  const schedule = await RideSchedule.findByPk(req.params.id, {
    include: [{ association: "contract" }],
  });

  if (!schedule) {
    return res
      .status(404)
      .json({ success: false, message: "RideSchedule not found" });
  }
  if (req.user.type === "driver" && schedule.driver_id !== req.user.id) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  const sch = schedule.toJSON();
  try {
    if (sch.driver_id) {
      const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
      const info = await getDriverById(sch.driver_id, authHeader);
      if (info) {
        sch.driver_name = info.name || null;
        sch.driver_phone = info.phone || null;
        sch.driver_email = info.email || null;
      }
    }
  } catch (_) {}
  res.json({ success: true, data: sch });
});

// UPDATE - Admin can update all, Driver can only update status of their assigned schedules
exports.updateRideSchedule = asyncHandler(async (req, res) => {
  if (req.user.type === "driver") {
    // Drivers can only update status field
    const allowedUpdates = { status: req.body.status };
    const [updated] = await RideSchedule.update(allowedUpdates, {
      where: { id: req.params.id, driver_id: req.user.id },
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "RideSchedule not found or access denied",
      });
    }
  } else {
    const [updated] = await RideSchedule.update(req.body, {
      where: { id: req.params.id },
    });

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "RideSchedule not found" });
    }
  }

  res.json({ success: true, message: "RideSchedule updated" });
});

// DELETE
exports.deleteRideSchedule = asyncHandler(async (req, res) => {
  const deleted = await RideSchedule.destroy({ where: { id: req.params.id } });
  if (!deleted)
    return res
      .status(404)
      .json({ success: false, message: "RideSchedule not found" });
  res.json({ success: true, message: "RideSchedule deleted" });
});
