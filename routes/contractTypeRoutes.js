const express = require("express");
const router = express.Router();
const { authorize } = require("../middleware/auth");
const controller = require("../controllers/contractTypeController");

// Admin routes
router.post("/", authorize("admin", "superadmin"), controller.createContractType);
router.get("/", authorize("admin", "superadmin", "passenger"), controller.getContractTypes);
router.get("/active", authorize("admin", "superadmin", "passenger"), controller.getActiveContractTypes);
router.get("/:id", authorize("admin", "superadmin", "passenger"), controller.getContractType);
router.put("/:id", authorize("admin", "superadmin"), controller.updateContractType);
router.delete("/:id", authorize("admin", "superadmin"), controller.deleteContractType);

module.exports = router;
