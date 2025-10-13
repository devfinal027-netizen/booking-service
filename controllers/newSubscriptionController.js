const { Subscription, Contract, ContractSettings, ContractType } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");
const { getPassengerById, getDriverById } = require("../utils/userService");
const { calculateSubscriptionFare, getAvailableContracts } = require("../services/subscriptionService");
const { createPaymentForSubscription } = require("./paymentController");
const { getUserInfo, populateUserFields } = require("../utils/tokenHelper");
const santim = require("../utils/santimpay");

// Helper function to get contract type ID from contract
function getContractTypeId(contract) {
  // If it's a virtual contract from ContractType, use the contract's ID
  if (contract.contract_type_id) {
    return contract.contract_type_id;
  }
  // If it's a ContractType object, use its ID
  if (contract.contractType && contract.contractType.id) {
    return contract.contractType.id;
  }
  // If it's the contract ID itself (when using contract type ID as contract_id)
  if (contract.id) {
    return contract.id;
  }
  return null;
}

// POST /subscription/create - Create subscription with fare estimation
exports.createSubscription = asyncHandler(async (req, res) => {
  const {
    contract_id,
    pickup_location,
    dropoff_location,
    pickup_latitude,
    pickup_longitude,
    dropoff_latitude,
    dropoff_longitude,
    start_date,
    end_date,
  } = req.body;

  // Debug user information
  console.log("User info:", {
    id: req.user.id,
    type: req.user.type,
    roles: req.user.roles
  });

  // Validate required fields
  if (!contract_id || !pickup_location || !dropoff_location || !start_date || !end_date) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: contract_id, pickup_location, dropoff_location, start_date, end_date"
    });
  }

  // Validate contract exists and is active
  let contract = await Contract.findOne({
    where: { id: contract_id, status: 'ACTIVE' }
  });

  // If no contract found, check if it's a contract type ID
  if (!contract) {
    const contractType = await ContractType.findByPk(contract_id);
    if (contractType && contractType.is_active) {
      // Create a virtual contract from contract type
      contract = {
        id: contractType.id,
        contract_type_id: contractType.id,
        cost: contractType.base_price_per_km,
        status: 'ACTIVE',
        contractType: contractType
      };
    } else {
      return res.status(404).json({
        success: false,
        message: "Contract not found or not active"
      });
    }
  }

  // Get passenger ID from authenticated user
  const passengerId = req.user.id;

  try {
    // Get passenger info from token
    const passengerInfo = await getUserInfo(req, passengerId, 'passenger');

    // Calculate fare estimation
    // Pass the contract type object or contract type string
    const contractTypeForFare = contract.contractType || contract.contract_type || contract;
    
    const fareResult = await calculateSubscriptionFare(
      pickup_location,
      dropoff_location,
      pickup_latitude,
      pickup_longitude,
      dropoff_latitude,
      dropoff_longitude,
      contractTypeForFare
    );

    if (!fareResult.success) {
      return res.status(400).json(fareResult);
    }

    // Determine if we're using a contract type directly or an actual contract
    const isUsingContractTypeDirectly = contract.id === contract_id && contract.contract_type_id === contract_id;
    
    // Create subscription with PENDING status and passenger info
    const subscriptionData = {
      contract_id: isUsingContractTypeDirectly ? null : contract_id, // Set to null if using contract type directly
      passenger_id: passengerId,
      passenger_name: passengerInfo?.name || null,
      passenger_phone: passengerInfo?.phone || null,
      passenger_email: passengerInfo?.email || null,
      pickup_location,
      dropoff_location,
      pickup_latitude: pickup_latitude || null,
      pickup_longitude: pickup_longitude || null,
      dropoff_latitude: dropoff_latitude || null,
      dropoff_longitude: dropoff_longitude || null,
      contract_type_id: getContractTypeId(contract),
      start_date,
      end_date,
      fare: fareResult.data.base_fare,
      discount_applied: fareResult.data.discount_amount,
      final_fare: fareResult.data.total_fare,
      distance_km: fareResult.data.distance_km,
      status: "PENDING",
      // payment_status is set by payment webhook only
    };

    const subscription = await Subscription.create(subscriptionData);

    res.status(201).json({
      success: true,
      message: "Subscription created successfully with fare estimation",
      data: {
        subscription: {
          ...subscription.toJSON(),
          passenger_name: passengerInfo?.name || null,
          passenger_phone: passengerInfo?.phone || null,
          passenger_email: passengerInfo?.email || null,
        },
        fare_estimation: fareResult.data,
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error creating subscription",
      error: error.message
    });
  }
});

// POST /subscription/:id/payment - Process payment for subscription
exports.processPayment = asyncHandler(async (req, res) => {
  const subscriptionId = req.params.id;

  const subscription = await Subscription.findByPk(subscriptionId, { include: [{ model: Contract, as: "contract" }] });
  if (!subscription) {
    return res.status(404).json({ success: false, message: "Subscription not found" });
  }
  if (req.user.type === "passenger" && String(subscription.passenger_id) !== String(req.user.id)) {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  if (subscription.payment_status === "PAID") {
    return res.status(400).json({ success: false, message: "Subscription is already paid" });
  }

  const normalizeMsisdnEt = (raw) => {
    if (!raw) return null;
    let s = String(raw).trim();
    s = s.replace(/\s+/g, "").replace(/[-()]/g, "");
    if (/^\+?251/.test(s)) {
      s = s.replace(/^\+?251/, "+251");
    } else if (/^0\d+/.test(s)) {
      s = s.replace(/^0/, "+251");
    } else if (/^9\d{8}$/.test(s)) {
      s = "+251" + s;
    }
    if (!/^\+2519\d{8}$/.test(s)) return null;
    return s;
  };
  const normalizePaymentMethod = (method) => {
    const raw = String(method || "").trim();
    const m = raw.toLowerCase();
    const table = { telebirr: 'Telebirr', tele: 'Telebirr', 'tele-birr': 'Telebirr', 'tele birr': 'Telebirr', cbe: 'CBE', 'cbe-birr': 'CBE', cbebirr: 'CBE', 'cbe birr': 'CBE', hellocash: 'HelloCash', 'hello-cash': 'HelloCash', 'hello cash': 'HelloCash', mpesa: 'MPesa', 'm-pesa': 'MPesa', 'm pesa': 'MPesa', 'm_pesa': 'MPesa', abyssinia: 'Abyssinia', awash: 'Awash', dashen: 'Dashen', bunna: 'Bunna', amhara: 'Amhara', berhan: 'Berhan', zamzam: 'ZamZam', yimlu: 'Yimlu' };
    if (table[m]) return table[m];
    if (m.includes('bank')) return 'CBE';
    return raw;
  };

  // Prefer subscription's final fare; fall back to request body
  const amount = parseFloat((subscription.final_fare ?? 0) || req.body.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: "Invalid amount (must be > 0)." });
  }

  // Determine payment method using, in order: explicit payment_option_id, explicit name, user preference
  let paymentMethodRaw = null;
  try {
    const { PaymentPreference, PaymentOption } = require("../models/indexModel");
    if (req.body && req.body.payment_option_id) {
      const opt = await PaymentOption.findByPk(req.body.payment_option_id);
      if (opt && opt.name) paymentMethodRaw = opt.name;
    }
    if (!paymentMethodRaw) {
      paymentMethodRaw = req.body.payment_method || req.body.paymentMethod || null;
    }
    if (!paymentMethodRaw) {
      const pref = await PaymentPreference.findOne({ where: { user_id: String(req.user.id), user_type: String(req.user.type) } });
      if (pref) {
        const opt = await PaymentOption.findByPk(pref.payment_option_id);
        if (opt && opt.name) paymentMethodRaw = opt.name;
      }
    }
  } catch (_) {}
  const paymentMethod = normalizePaymentMethod(paymentMethodRaw || 'telebirr');

  // Resolve phone number strictly from token, then fallbacks to token service and subscription data
  let tokenPhone = req.user && (req.user.phone || req.user.phoneNumber || req.user.mobile);
  if (!tokenPhone) {
    try {
      const { getUserInfo } = require("../utils/tokenHelper");
      const info = await getUserInfo(req, req.user.id, 'passenger');
      if (info && (info.phone || info.phoneNumber || info.mobile)) {
        tokenPhone = info.phone || info.phoneNumber || info.mobile;
      }
    } catch (_) {}
  }
  if (!tokenPhone && subscription && (subscription.passenger_phone || subscription.passengerMobile)) {
    tokenPhone = subscription.passenger_phone || subscription.passengerMobile;
  }
  const msisdn = normalizeMsisdnEt(tokenPhone);
  if (!msisdn) {
    return res.status(400).json({ success: false, message: "Missing or invalid passenger phone; please ensure the token contains a valid +2519XXXXXXXX." });
  }

  try {
    // Use unified SantimPay notify URL only (single webhook endpoint)
    const notifyUrl = String(process.env.SANTIMPAY_NOTIFY_URL || '').trim();
    if (!notifyUrl) {
      return res.status(500).json({ success: false, message: "SANTIMPAY_NOTIFY_URL is not configured" });
    }
    const reason = `Subscription Payment ${subscriptionId}`;

    // Structured debug log before gateway call (no secrets)
    console.log("[Payment] Initiating gateway directPayment", {
      subscriptionId: String(subscriptionId),
      amount,
      paymentMethod,
      msisdn,
      notifyUrl,
    });

    const gw = await santim.directPayment({ id: String(subscriptionId), amount, paymentReason: reason, notifyUrl, phoneNumber: msisdn, paymentMethod });
    const gwTxnId = gw?.TxnId || gw?.txnId || gw?.data?.TxnId || gw?.data?.txnId || null;

    console.log("[Payment] Gateway response", { ok: !!gw, gwTxnId, raw: gw });

    await Subscription.update({ payment_reference: gwTxnId || String(subscriptionId) }, { where: { id: subscriptionId } });

    // Create pending wallet transaction when payment is initiated
    try {
      const { Wallet, Transaction } = require("../models/indexModel");
      const { randomUUID } = require("crypto");
      
      // Get or create wallet for the passenger
      const userId = String(req.user.id);
      let wallet = await Wallet.findOne({ where: { userId } });
      if (!wallet) {
        wallet = await Wallet.create({ userId, balance: 0 });
      }

      // Create pending transaction record
      const txId = randomUUID();
      
      await Transaction.create({
        refId: String(txId),
        txnId: gwTxnId,
        userId,
        amount,
        type: "debit",
        method: "santimpay",
        status: "pending",
        msisdn,
        walletId: wallet.id,
        metadata: {
          subscriptionId: subscriptionId,
          reason: "Subscription Payment Initiated",
          paymentMethod,
          gatewayResponse: gw
        }
      });

      console.log("[Payment] Created pending wallet transaction", {
        subscriptionId,
        userId,
        amount,
        txId,
        gwTxnId
      });
    } catch (walletError) {
      console.error("[Payment] Failed to create pending wallet transaction:", walletError);
      // Don't fail the payment initiation if wallet transaction creation fails
    }

    return res.json({ success: true, message: "Subscription payment initiated", data: { subscription_id: subscriptionId, gatewayTxnId: gwTxnId, amount, payment_method: paymentMethod } });
  } catch (error) {
    // Capture gateway error details for diagnostics
    const status = error?.response?.status;
    const data = error?.response?.data;
    const payloadEcho = {
      amount,
      paymentMethod,
      msisdn,
    };
    console.error("[Payment] Gateway error", { status, data, message: error.message, payload: payloadEcho });
    return res.status(502).json({ success: false, message: `Payment initiation failed: ${error.message}`, gateway_status: status, gateway_response: data });
  }
});

// SantimPay webhook for subscription payments
exports.subscriptionPaymentWebhook = asyncHandler(async (req, res) => {
  try {
    const body = req.body || {};
    const data = body.data || body;
    const thirdPartyId = data.thirdPartyId || data.ID || data.id || data.transactionId || data.clientReference;
    const gwTxnId = data.TxnId || data.txnId;
    const rawStatus = (data.Status || data.status || "").toString().toUpperCase();
    const success = ["COMPLETED", "SUCCESS", "APPROVED"].includes(rawStatus);

    // Match subscription by id (we used subscriptionId as id) or by stored payment_reference matching gateway txn id
    let subscription = null;
    if (thirdPartyId) {
      subscription = await Subscription.findByPk(String(thirdPartyId));
    }
    if (!subscription && gwTxnId) {
      subscription = await Subscription.findOne({ where: { payment_reference: String(gwTxnId) } });
    }

    if (!subscription) {
      return res.status(200).json({ ok: false, message: "Subscription not found for webhook", thirdPartyId, txnId: gwTxnId });
    }

    // Only update payment status, not subscription status
    const paymentStatus = success ? "PAID" : "FAILED";
    await Subscription.update({ 
      payment_status: paymentStatus, 
      payment_reference: gwTxnId || subscription.payment_reference 
    }, { where: { id: subscription.id } });

    // Create wallet transaction for ALL payment statuses (pending, success, failed)
    try {
      const { Wallet, Transaction } = require("../models/indexModel");
      const { Op } = require("sequelize");
      const { randomUUID } = require("crypto");
      
      // Get or create wallet for the passenger
      const userId = String(subscription.passenger_id);
      let wallet = await Wallet.findOne({ where: { userId } });
      if (!wallet) {
        wallet = await Wallet.create({ userId, balance: 0 });
      }

      const amount = parseFloat(subscription.final_fare || subscription.total_fare || 0);
      
      // Map webhook status to transaction status
      let transactionStatus = "pending";
      if (success) {
        transactionStatus = "success";
      } else if (rawStatus === "FAILED" || rawStatus === "REJECTED") {
        transactionStatus = "failed";
      }
      
      // Try to find existing transaction by subscription ID or gateway transaction ID
      let existingTransaction = await Transaction.findOne({
        where: {
          [Op.or]: [
            { txnId: gwTxnId },
            { 
              metadata: {
                [Op.contains]: { subscriptionId: subscription.id }
              }
            }
          ]
        }
      });

      if (existingTransaction) {
        // Update existing transaction
        await existingTransaction.update({
          status: transactionStatus,
          txnId: gwTxnId,
          msisdn: data.Msisdn || data.msisdn,
          metadata: {
            ...existingTransaction.metadata,
            subscriptionId: subscription.id,
            reason: "Subscription Payment",
            gatewayResponse: data,
            webhookStatus: rawStatus,
            updatedAt: new Date().toISOString()
          }
        });
        console.log("[Subscription Webhook] Updated existing wallet transaction", {
          transactionId: existingTransaction.id,
          subscriptionId: subscription.id,
          transactionStatus,
          webhookStatus: rawStatus
        });
      } else {
        // Create new transaction if none exists
        const txId = randomUUID();
        await Transaction.create({
          refId: String(txId),
          txnId: gwTxnId,
          userId,
          amount,
          type: "debit", // Subscription payment is a debit from passenger's perspective
          method: "santimpay",
          status: transactionStatus,
          msisdn: data.Msisdn || data.msisdn,
          walletId: wallet.id,
          metadata: {
            subscriptionId: subscription.id,
            reason: "Subscription Payment",
            gatewayResponse: data,
            webhookStatus: rawStatus
          }
        });
        console.log("[Subscription Webhook] Created new wallet transaction", {
          subscriptionId: subscription.id,
          userId,
          amount,
          txId,
          gwTxnId,
          transactionStatus,
          webhookStatus: rawStatus
        });
      }

      // Only update wallet balance for successful payments
      if (success) {
        const newBalance = parseFloat(wallet.balance) - amount;
        await wallet.update({ 
          balance: newBalance,
          lastTransactionAt: new Date()
        });
      }

      console.log("[Subscription Webhook] Created wallet transaction", {
        subscriptionId: subscription.id,
        userId,
        amount,
        txId,
        gwTxnId,
        transactionStatus,
        webhookStatus: rawStatus
      });
    } catch (walletError) {
      console.error("[Subscription Webhook] Failed to create wallet transaction:", walletError);
      // Don't fail the webhook if wallet transaction creation fails
    }

    return res.status(200).json({ ok: true, subscription_id: subscription.id, status: success ? "PAID" : "FAILED", gatewayTxnId: gwTxnId });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
});

// GET /subscriptions/pending - Get all pending subscriptions (Admin only)
exports.getPendingSubscriptions = asyncHandler(async (req, res) => {
  // Check if user is admin
  if (req.user.type !== "admin" && req.user.type !== "superadmin") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin privileges required."
    });
  }

  const pendingSubscriptions = await Subscription.findAll({
    where: {
      status: "PENDING"
    },
    include: [
      { model: Contract, as: "contract" },
      { model: ContractType, as: "contractType" }
    ],
    order: [['createdAt', 'ASC']]
  });

  // Enrich with passenger info from token
  const enriched = await Promise.all(pendingSubscriptions.map(async (subscription) => {
    let info = null;
    try { info = await getUserInfo(req, subscription.passenger_id, 'passenger'); } catch (_) {}
    const sub = subscription.toJSON();
    return {
      ...sub,
      passenger_name: info?.name || sub.passenger_name || null,
      passenger_phone: info?.phone || sub.passenger_phone || null,
      passenger_email: info?.email || sub.passenger_email || null,
    };
  }));

  res.json({
    success: true,
    data: {
      pending_subscriptions: enriched,
      total_count: enriched.length
    }
  });
});

// GET /passenger/:id/subscriptions - Get passenger's subscriptions (active and history)
exports.getPassengerSubscriptions = asyncHandler(async (req, res) => {
  const passengerId = req.params.id;

  // Check if user can access this passenger's data
  if (req.user.type === "passenger" && req.user.id !== passengerId) {
    return res.status(403).json({
      success: false,
      message: "Access denied"
    });
  }

  try {
    const subscriptions = await Subscription.findAll({
      where: { passenger_id: passengerId },
      order: [['createdAt', 'DESC']],
    });

    // Get passenger info from token
    const passengerInfo = await getUserInfo(req, passengerId, 'passenger');

    // Enrich subscriptions with user information and expiration details
    const enrichedSubscriptions = await Promise.all(
      subscriptions.map(async (subscription) => {
        const subData = subscription.toJSON();
        let driverFromToken = null;
        let driverFromExternal = null;

        // Fetch driver from token helper (may include embedded vehicle_info)
        if (subscription.driver_id) {
          try {
            driverFromToken = await getUserInfo(req, subscription.driver_id, 'driver');
          } catch (_) {}

          // Also try external user service for richer fields (admin-like)
          try {
            const authHeader = req.headers && req.headers.authorization ? { headers: { Authorization: req.headers.authorization } } : {};
            driverFromExternal = await getDriverById(subscription.driver_id, authHeader);
          } catch (_) {}
        }

        // Build merged driver details with fallbacks
        const driver_name = (driverFromExternal && driverFromExternal.name) || (driverFromToken && driverFromToken.name) || subData.driver_name || null;
        const driver_phone = (driverFromExternal && driverFromExternal.phone) || (driverFromToken && driverFromToken.phone) || subData.driver_phone || (subscription.driver_id ? 'Not available' : null);
        const driver_email = (driverFromExternal && driverFromExternal.email) || (driverFromToken && driverFromToken.email) || subData.driver_email || (subscription.driver_id ? 'Not available' : null);

        // Normalize vehicle info to snake_case as per stored schema and sample response
        const normalizedVehicleInfo = (function() {
          const fromExternal = driverFromExternal ? {
            car_model: driverFromExternal.carModel || driverFromExternal.vehicleType || null,
            car_plate: driverFromExternal.carPlate || null,
            car_color: driverFromExternal.carColor || null,
          } : null;
          const fromToken = driverFromToken && driverFromToken.vehicle_info ? {
            car_model: driverFromToken.vehicle_info.carModel || driverFromToken.vehicle_info.vehicleType || null,
            car_plate: driverFromToken.vehicle_info.carPlate || null,
            car_color: driverFromToken.vehicle_info.carColor || null,
          } : null;
          const fromStored = subData.vehicle_info || null;
          return fromExternal || fromToken || fromStored || null;
        })();

        const endDate = new Date(subscription.end_date);
        const today = new Date();
        const daysUntilExpiry = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

        return {
          ...subData,
          passenger_name: passengerInfo?.name || subData.passenger_name || null,
          passenger_phone: passengerInfo?.phone || subData.passenger_phone || null,
          passenger_email: passengerInfo?.email || subData.passenger_email || null,
          driver_name,
          driver_phone,
          driver_email,
          vehicle_info: normalizedVehicleInfo,
          expiration_date: subscription.end_date,
          days_until_expiry: daysUntilExpiry,
          is_expired: daysUntilExpiry < 0,
        };
      })
    );

    // Separate active and completed subscriptions
    const activeSubscriptions = enrichedSubscriptions.filter(s => 
      s.status === "ACTIVE" && !s.is_expired
    );
    const historySubscriptions = enrichedSubscriptions.filter(s => 
      s.status !== "ACTIVE" || s.is_expired
    );

    res.json({
      success: true,
      data: {
        passenger_id: passengerId,
        passenger_name: passengerInfo?.name || null,
        passenger_phone: passengerInfo?.phone || null,
        passenger_email: passengerInfo?.email || null,
        active_subscriptions: activeSubscriptions,
        subscription_history: historySubscriptions,
        counters: {
          total_subscriptions: enrichedSubscriptions.length,
          active_count: activeSubscriptions.length,
          history_count: historySubscriptions.length,
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching passenger subscriptions",
      error: error.message
    });
  }
});

// GET /subscription/contracts - Get available contracts for subscription
exports.getAvailableContracts = asyncHandler(async (req, res) => {
  const { contract_type } = req.query;

  try {
    let whereClause = { status: 'ACTIVE' };
    if (contract_type) {
      whereClause.contract_type = contract_type;
    }

    const contracts = await Contract.findAll({
      where: whereClause,
      attributes: ['id', 'has_discount', 'contract_type', 'status'], // Only return required fields
      order: [['contract_type', 'ASC'], ['createdAt', 'DESC']],
    });

    // Enrich contracts with discount information
    const enrichedContracts = await Promise.all(
      contracts.map(async (contract) => {
        const contractData = contract.toJSON();
        
        // Get contract settings for discount info
        const contractSettings = await ContractSettings.findOne({
          where: { contract_type: contract.contract_type }
        });

        return {
          ...contractData,
          discount_percentage: contractSettings?.discount_percentage || 0,
          discount_amount: null, // Will be calculated based on fare
          base_price_per_km: contractSettings?.base_price_per_km || 0,
          minimum_fare: contractSettings?.minimum_fare || 0,
        };
      })
    );

    res.json({
      success: true,
      data: {
        contracts: enrichedContracts,
        total_count: enrichedContracts.length,
        filter_applied: contract_type || null,
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching available contracts",
      error: error.message
    });
  }
});