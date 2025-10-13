const express = require("express");
const router = express.Router();
const { authorize } = require("../middleware/auth");
const controller = require("../controllers/walletController");

// Topup and webhook
router.post("/topup", authorize("passenger"), controller.topup);
router.post("/webhook", controller.webhook);
router.get("/balance", controller.getBalance);
router.get("/transactions", authorize("admin", "passenger"), controller.transactions);
router.get("/transactions/:userId", authorize("admin"), controller.transactions);
router.get("/admin/balances", authorize("admin"), controller.adminBalances);
router.get("/admin/transactions", authorize("admin"), controller.adminTransactions);
router.get("/debug", controller.debug); // Debug endpoint to see MySQL storage
router.post("/withdraw", controller.withdraw); // Not implemented

module.exports = router;

