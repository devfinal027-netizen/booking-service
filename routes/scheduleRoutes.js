const express = require("express");
const router = express.Router();
const { authorize } = require("../middleware/auth");
const controller = require("../controllers/scheduleController");
const { validateDaysOfWeek, validateWeeklyPattern } = require("../utils/dayValidation");

// Middleware for day validation
const validateScheduleDays = (req, res, next) => {
  try {
    const { pattern_type, days_of_week } = req.body;
    
    if (days_of_week) {
      validateDaysOfWeek(days_of_week);
      validateWeeklyPattern(pattern_type, days_of_week);
    }
    
    next();
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

router.post("/", authorize("admin"),  validateScheduleDays, controller.createRideSchedule);
router.get("/", authorize("admin", "driver"), controller.getRideSchedules);
router.get("/:id", authorize("admin", "driver"), controller.getRideSchedule);
router.put("/:id", authorize("admin", "driver"),  validateScheduleDays, controller.updateRideSchedule);
router.delete("/:id", authorize("admin"), controller.deleteRideSchedule);

module.exports = router;
