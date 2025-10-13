const express = require("express");
const router = express.Router();
const { authorize } = require("../middleware/auth");
const controller = require("../controllers/paymentOptionController");

// Admin manages options
router.get("/options", authorize("admin", "passenger", "driver"), controller.list);
router.post("/options", authorize("admin"), controller.create);
router.put("/options/:id", authorize("admin"), controller.update);
router.delete("/options/:id", authorize("admin"), controller.remove);
router.get("/partners", authorize("admin", "passenger", "driver"), controller.partners);

// User sets preference
router.get("/preference", authorize("passenger", "driver"), controller.getPreference);
router.post("/preference", authorize("passenger", "driver"), controller.setPreference);

module.exports = router;

