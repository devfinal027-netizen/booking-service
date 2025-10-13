const express = require("express");
const router = express.Router();
const { authorize } = require("../middleware/auth");
const controller = require("../controllers/subscriptionController");
const { validateContractDates } = require("../middleware/dateValidation");

router.post(
  "/",
  authorize("admin", "passenger"), validateContractDates,
  controller.createSubscription
);
router.get("/", authorize("admin", "passenger"), controller.getSubscriptions);
router.get("/:id", authorize("admin", "passenger"), controller.getSubscription);
router.put("/:id", authorize("admin"), validateContractDates, controller.updateSubscription);
router.delete("/:id", authorize("admin"), controller.deleteSubscription);

module.exports = router;
