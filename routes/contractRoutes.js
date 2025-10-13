const express = require("express");
const router = express.Router();
const { authorize } = require("../middleware/auth");
const controller = require("../controllers/contractController");
const { validateContractDates } = require("../middleware/dateValidation");

// Put SPECIFIC routes BEFORE parameterized routes
router.get('/active', authorize("admin", "superadmin", "passenger", "driver"), controller.getActiveContracts);
router.get('/type/:contractTypeId', authorize("admin", "superadmin", "passenger", "driver"), controller.getContractsByType);

// Parameterized routes should come AFTER specific routes
router.post("/", authorize("admin", "superadmin"), validateContractDates, controller.createContract);
router.get("/", authorize("admin", "superadmin", "passenger"), controller.getContracts);
router.get("/:id", authorize("admin", "superadmin"), controller.getContract);
router.put("/:id", authorize("admin", "superadmin"), validateContractDates, controller.updateContract);
router.delete("/:id", authorize("admin", "superadmin"), controller.deleteContract);

module.exports = router;