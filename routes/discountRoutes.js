const express = require("express");
const router = express.Router();
const controller = require("../controllers/discountController");

router.post("/", controller.createDiscount);
router.get("/", controller.getDiscounts);
router.get("/:id", controller.getDiscount);
router.put("/:id", controller.updateDiscount);
router.delete("/:id", controller.deleteDiscount);

module.exports = router;
