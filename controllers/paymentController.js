const { Payment, Subscription, Contract } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { deleteFile } = require("../utils/fileHelper");
const path = require("path");
const { getPassengerById, getAdminById } = require("../utils/userService");
const { getUserInfo } = require("../utils/tokenHelper");

// Normalize flexible payment_method inputs to model ENUM values
function normalizeManualPaymentMethod(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (["bank", "bank_transfer", "manual bank", "manual bank transfer", "bank transfer"].includes(s)) return "BANK_TRANSFER";
  if (["mobile", "mobile_money", "mobile money", "momo", "telebirr", "cbe birr", "cbebirr", "cbe", "amole", "hello cash", "hellocash", "hellocash"].includes(s)) {
    if (s.includes("telebirr")) return "TELEBIRR";
    if (s.includes("amole")) return "AMOLE";
    if (s.includes("hello")) return "HELLO_CASH";
    return "MOBILE_MONEY";
  }
  if (["cash"].includes(s)) return "CASH";
  if (["card", "visa", "mastercard"].includes(s)) return "CARD";
  // Fallback: try upper snake case
  return s.replace(/\s+/g, "_").toUpperCase();
}

// CREATE payment for subscription (used by newSubscriptionController)
exports.createPaymentForSubscription = async (subscriptionId, paymentData, file = null) => {
  try {
    console.log("createPaymentForSubscription called with:", {
      subscriptionId,
      paymentData,
      hasFile: !!file
    });

    // Get subscription details
    const subscription = await Subscription.findByPk(subscriptionId, {
      include: [{ model: Contract, as: "contract" }]
    });

    console.log("Subscription found in createPaymentForSubscription:", {
      found: !!subscription,
      subscriptionId: subscription?.id,
      contractId: subscription?.contract_id,
      passengerId: subscription?.passenger_id
    });

    if (!subscription) {
      throw new Error("Subscription not found");
    }

  const payment = {
    subscription_id: subscriptionId,
    contract_id: subscription.contract_id,
    passenger_id: subscription.passenger_id,
    amount: paymentData.amount || subscription.final_fare,
    payment_method: paymentData.payment_method,
    transaction_reference: paymentData.transaction_reference,
    due_date: paymentData.due_date || new Date(),
    status: paymentData.status || "PENDING",
    admin_approved: false,
  };

  // Handle receipt image from form data or file upload
  if (paymentData.receipt_image) {
    payment.receipt_image = paymentData.receipt_image;
  } else if (file) {
    payment.receipt_image = path.join("uploads", "payments", file.filename);
  }

  console.log("About to create payment with data:", payment);
  
  const createdPayment = await Payment.create(payment);
  
  console.log("Payment created successfully:", {
    id: createdPayment.id,
    amount: createdPayment.amount,
    payment_method: createdPayment.payment_method
  });
  
    console.log("About to return payment object:", {
      hasId: !!createdPayment.id,
      hasAmount: !!createdPayment.amount,
      fullObject: createdPayment.toJSON ? createdPayment.toJSON() : createdPayment
    });
    
    return createdPayment;
  } catch (error) {
    console.error("Error in createPaymentForSubscription:", error);
    throw error;
  }
};

// CREATE with file upload (manual payment submission)
exports.createPayment = asyncHandler(async (req, res) => {
  const { subscription_id, amount, payment_method, transaction_reference, due_date } = req.body;

  // Validate required fields (amount optional - inferred from subscription if missing)
  if (!subscription_id || !payment_method) {
    return res.status(400).json({
      success: false,
      message: "subscription_id and payment_method are required"
    });
  }

  // Verify subscription exists and belongs to passenger
  const subscription = await Subscription.findOne({
    where: { 
      id: subscription_id,
      passenger_id: req.user.id 
    },
    include: [{ model: Contract, as: "contract" }]
  });

  if (!subscription) {
    return res.status(404).json({
      success: false,
      message: "Subscription not found or access denied"
    });
  }

  const inferredAmount = amount != null && amount !== '' ? parseFloat(amount) : parseFloat(subscription.final_fare || subscription.total_fare || 0);
  const normalizedMethod = normalizeManualPaymentMethod(payment_method);
  const paymentData = {
    subscription_id,
    contract_id: subscription.contract_id,
    passenger_id: req.user.id,
    amount: inferredAmount,
    payment_method: normalizedMethod,
    transaction_reference,
    due_date: due_date || new Date(),
    status: "PENDING",
    admin_approved: false,
  };

  if (req.file) {
    paymentData.receipt_image = path.join("uploads", "payments", req.file.filename);
  }

  const payment = await Payment.create(paymentData);
  
  res.status(201).json({ 
    success: true, 
    message: "Payment submitted for admin approval",
    paymentId: payment.id,
    data: payment 
  });
});

// READ all - Admin sees all, Passenger sees only their own
exports.getPayments = asyncHandler(async (req, res) => {
  let whereClause = {};

  if (req.user.type === "passenger") {
    whereClause.passenger_id = req.user.id;
  }

  const payments = await Payment.findAll({
    where: whereClause,
    include: [
      { model: Contract, as: "contract" },
      { model: Subscription, as: "subscription" }
    ],
  });

  const paymentsWithUrls = payments.map((payment) => ({
    ...payment.toJSON(),
    receipt_image_url: payment.receipt_image
      ? `${req.protocol}://${req.get("host")}/${payment.receipt_image}`
      : null,
  }));

  // Enrich with passenger info (name, phone, email)
  const uniquePassengerIds = [...new Set(paymentsWithUrls.map(p => p.passenger_id).filter(Boolean))];
  const passengerInfoMap = new Map();
  await Promise.all(uniquePassengerIds.map(async (pid) => {
    try {
      const info = await getUserInfo(req, pid, 'passenger');
      if (info) passengerInfoMap.set(pid, info);
    } catch (_) {}
  }));

  const enriched = paymentsWithUrls.map(p => {
    const info = passengerInfoMap.get(p.passenger_id);
    const safe = info || {};
    return {
      ...p,
      passenger_name: safe.name || `Passenger ${String(p.passenger_id || '').slice(-4)}`,
      passenger_phone: safe.phone || 'Not available',
      passenger_email: safe.email || 'Not available',
    };
  });

  res.json({ success: true, data: enriched });
});

// READ one - Admin sees all, Passenger sees only their own
exports.getPayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findByPk(req.params.id, {
    include: [
      { model: Contract, as: "contract" },
      { model: Subscription, as: "subscription" }
    ],
  });

  if (!payment) {
    return res
      .status(404)
      .json({ success: false, message: "Payment not found" });
  }

  // Ownership check for passengers
  if (req.user.type === "passenger" && payment.passenger_id !== req.user.id) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }

  // Add full URL for the receipt image
  const paymentWithUrl = {
    ...payment.toJSON(),
    receipt_image_url: payment.receipt_image
      ? `${req.protocol}://${req.get("host")}/${payment.receipt_image}`
      : null,
  };

  // Enrich single payment with passenger info
  try {
    if (paymentWithUrl.passenger_id) {
      const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
      const info = await getPassengerById(paymentWithUrl.passenger_id, authHeader);
      if (info) {
        paymentWithUrl.passenger_name = info.name || null;
        paymentWithUrl.passenger_phone = info.phone || null;
        paymentWithUrl.passenger_email = info.email || null;
      }
    }
  } catch (_) {}

  res.json({ success: true, data: paymentWithUrl });
});

// UPDATE with optional file upload
exports.updatePayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findByPk(req.params.id);

  if (!payment) {
    return res
      .status(404)
      .json({ success: false, message: "Payment not found" });
  }

  const updateData = { ...req.body };

  // Handle file upload - delete old file if new one is uploaded
  if (req.file) {
    // Delete old file if it exists
    if (payment.receipt_image) {
      deleteFile(payment.receipt_image);
    }

    // Save the relative path to the new file
    updateData.receipt_image = path.join(
      "uploads",
      "payments",
      req.file.filename
    );
  }

  const [updated] = await Payment.update(updateData, {
    where: { id: req.params.id },
  });

  if (!updated) {
    return res
      .status(404)
      .json({ success: false, message: "Payment not found" });
  }

  res.json({ success: true, message: "Payment updated" });
});

// DELETE with file cleanup
exports.deletePayment = asyncHandler(async (req, res) => {
  const payment = await Payment.findByPk(req.params.id);

  if (!payment) {
    return res
      .status(404)
      .json({ success: false, message: "Payment not found" });
  }

  // Delete associated file if it exists
  if (payment.receipt_image) {
    deleteFile(payment.receipt_image);
  }

  const deleted = await Payment.destroy({ where: { id: req.params.id } });

  if (!deleted) {
    return res
      .status(404)
      .json({ success: false, message: "Payment not found" });
  }

  res.json({ success: true, message: "Payment deleted" });
});

// ADMIN: Approve payment
exports.approvePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user.id;

  const payment = await Payment.findByPk(id, {
    include: [
      { model: Subscription, as: "subscription" },
      { model: Contract, as: "contract" }
    ]
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Payment not found"
    });
  }

  if (payment.admin_approved) {
    return res.status(400).json({
      success: false,
      message: "Payment already approved"
    });
  }

  // Update payment status
  await Payment.update({
    admin_approved: true,
    approved_by: adminId,
    approved_at: new Date(),
    status: "SUCCESS",
    rejection_reason: null
  }, {
    where: { id }
  });

  // Update subscription payment status
  if (payment.subscription) {
    await Subscription.update({
      payment_status: "PAID",
      status: "ACTIVE"
    }, {
      where: { id: payment.subscription_id }
    });
  }

  // Get admin and passenger details for response (from token service with fallbacks)
  const adminInfo = await getUserInfo(req, adminId, 'admin');
  const passengerInfo = await getUserInfo(req, payment.passenger_id, 'passenger');

  res.json({
    success: true,
    message: "Payment approved successfully",
    data: {
      payment_id: id,
      approved_by: adminInfo?.name || String(adminId),
      approver: {
        id: adminInfo?.id || String(adminId),
        name: adminInfo?.name || `Admin ${String(adminId).slice(-4)}`,
        phone: adminInfo?.phone || 'Not available',
        email: adminInfo?.email || 'Not available',
      },
      approved_at: new Date(),
      subscription_status: "ACTIVE",
      passenger: {
        id: passengerInfo?.id || String(payment.passenger_id || ''),
        name: passengerInfo?.name || `Passenger ${String(payment.passenger_id || '').slice(-4)}`,
        phone: passengerInfo?.phone || 'Not available',
        email: passengerInfo?.email || 'Not available'
      }
    }
  });
});

// ADMIN: Reject payment
exports.rejectPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { rejection_reason } = req.body;
  const adminId = req.user.id;

  if (!rejection_reason) {
    return res.status(400).json({
      success: false,
      message: "rejection_reason is required"
    });
  }

  const payment = await Payment.findByPk(id, {
    include: [{ model: Subscription, as: "subscription" }]
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: "Payment not found"
    });
  }

  if (payment.admin_approved) {
    return res.status(400).json({
      success: false,
      message: "Cannot reject an already approved payment"
    });
  }

  // Update payment status
  await Payment.update({
    admin_approved: false,
    approved_by: adminId,
    approved_at: new Date(),
    status: "FAILED",
    rejection_reason
  }, {
    where: { id }
  });

  // Update subscription payment status
  if (payment.subscription) {
    await Subscription.update({
      payment_status: "FAILED"
    }, {
      where: { id: payment.subscription_id }
    });
  }

  // Get admin and passenger details for response
  const adminInfo = await getUserInfo(req, adminId, 'admin');
  const passengerInfo = await getUserInfo(req, payment.passenger_id, 'passenger');

  res.json({
    success: true,
    message: "Payment rejected",
    data: {
      payment_id: id,
      rejected_by: adminInfo?.name || String(adminId),
      rejector: {
        id: adminInfo?.id || String(adminId),
        name: adminInfo?.name || `Admin ${String(adminId).slice(-4)}`,
        phone: adminInfo?.phone || 'Not available',
        email: adminInfo?.email || 'Not available',
      },
      rejected_at: new Date(),
      rejection_reason,
      subscription_status: "PENDING",
      passenger: {
        id: passengerInfo?.id || String(payment.passenger_id || ''),
        name: passengerInfo?.name || `Passenger ${String(payment.passenger_id || '').slice(-4)}`,
        phone: passengerInfo?.phone || 'Not available',
        email: passengerInfo?.email || 'Not available'
      }
    }
  });
});

// Get pending payments for admin approval
exports.getPendingPayments = asyncHandler(async (req, res) => {
  const pendingPayments = await Payment.findAll({
    where: {
      admin_approved: false,
      status: "PENDING"
    },
    include: [
      { model: Contract, as: "contract" },
      { model: Subscription, as: "subscription" }
    ],
    order: [['createdAt', 'ASC']]
  });

  // Add receipt image URLs
  const paymentsWithUrls = pendingPayments.map((payment) => ({
    ...payment.toJSON(),
    receipt_image_url: payment.receipt_image
      ? `${req.protocol}://${req.get("host")}/${payment.receipt_image}`
      : null,
  }));

  // Enrich with passenger info
  const uniquePassengerIds = [...new Set(paymentsWithUrls.map(p => p.passenger_id).filter(Boolean))];
  const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
  const passengerInfoMap = new Map();
  
  await Promise.all(uniquePassengerIds.map(async (pid) => {
    try {
      const info = await getPassengerById(pid, authHeader);
      if (info) passengerInfoMap.set(pid, info);
    } catch (_) {}
  }));

  const enriched = paymentsWithUrls.map(p => {
    const info = passengerInfoMap.get(p.passenger_id);
    if (!info) return p;
    return {
      ...p,
      passenger_name: info.name || null,
      passenger_phone: info.phone || null,
      passenger_email: info.email || null,
    };
  });

  res.json({
    success: true,
    data: {
      pending_payments: enriched,
      total_count: enriched.length
    }
  });
});
