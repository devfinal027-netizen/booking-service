const { Wallet, Transaction } = require("../models/common");
const santim = require("../integrations/santimpay");
const mongoose = require("mongoose");

exports.topup = async (req, res) => {
  try {
    const { amount, paymentMethod, reason = "Wallet Topup" } = req.body || {};
    if (!amount || amount <= 0)
      return res.status(400).json({ message: "amount must be > 0" });

    // Phone can come from body or token
    const bodyPhone = req.body && (req.body.msisdn || req.body.phone || req.body.phoneNumber);
    const tokenPhone = req.user && (req.user.phone || req.user.phoneNumber || req.user.mobile);
    const rawPhone = bodyPhone || tokenPhone;
    if (!rawPhone)
      return res.status(400).json({ message: "phoneNumber missing (token/body)" });

    // Normalize Ethiopian MSISDN
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

    const msisdn = normalizeMsisdnEt(rawPhone);
    if (!msisdn)
      return res.status(400).json({
        message: "Invalid phone format in token. Required: +2519XXXXXXXX",
      });

    const userId = String(req.user.id);
    const role = req.user.type;

    let wallet = await Wallet.findOne({ userId, role });
    if (!wallet) wallet = await Wallet.create({ userId, role, balance: 0 });

    // Generate ObjectId manually so we can use it for txnId/refId
    const txId = new mongoose.Types.ObjectId();

    const tx = await Transaction.create({
      _id: txId,
      refId: txId.toString(),
      userId,
      role,
      amount,
      type: "credit",
      method: "santimpay",
      status: "pending",
      msisdn: msisdn,
      metadata: { reason },
    });

    // Resolve payment method from explicit param or driver's selected PaymentOption
    async function resolvePaymentMethod() {
      const pick = (v) => (typeof v === 'string' && v.trim().length) ? v.trim() : null;
      const explicit = pick(paymentMethod);
      if (explicit) {
        console.log('Using explicit payment method:', explicit);
        return explicit;
      }
      // Map paymentOptionId -> name
      try {
        const optId = req.body && (req.body.paymentOptionId || req.body.id);
        if (optId) {
          const PaymentOption = require('../models/paymentOption');
          const po = await PaymentOption.findById(String(optId)).select({ name: 1 }).lean();
          if (po && po.name) {
            console.log('Using payment option from request:', po.name);
            return String(po.name).trim();
          }
        }
      } catch (e) {
        console.error('Error resolving payment option from request:', e);
      }
      try {
        const { Driver } = require("../models/userModels");
        const idStr = String(userId);
        console.log('Looking for driver with ID:', idStr);
        // Driver._id is String in our schema; always try by _id first
        let me = await Driver.findOne({ _id: idStr }).select({ paymentPreferences: 1, paymentPreference: 1 }).populate([
          { path: 'paymentPreferences', select: { name: 1 } },
          { path: 'paymentPreference', select: { name: 1 } }
        ]);
        if (!me && (req.user?.email || req.user?.phone || req.user?.phoneNumber || req.user?.mobile)) {
          console.log('Driver not found by ID, trying by email/phone');
          me = await Driver.findOne({
            $or: [
              { email: req.user?.email || null },
              { phone: req.user?.phone || req.user?.phoneNumber || req.user?.mobile || null }
            ]
          }).select({ paymentPreferences: 1, paymentPreference: 1 }).populate([
            { path: 'paymentPreferences', select: { name: 1 } },
            { path: 'paymentPreference', select: { name: 1 } }
          ]);
        }
        console.log('Found driver:', me ? 'yes' : 'no');
        // Use first payment preference if available (handle both old and new formats)
        let prefs = [];
        if (me && me.paymentPreferences && Array.isArray(me.paymentPreferences)) {
          prefs = me.paymentPreferences;
        } else if (me && me.paymentPreference) {
          prefs = [me.paymentPreference];
        }
        if (prefs.length > 0) {
          const firstPref = prefs[0];
          const name = firstPref && (firstPref.name || (typeof firstPref === 'string' ? firstPref : null));
          if (name && String(name).trim().length) {
            console.log('Using first payment preference:', name);
            return String(name).trim();
          }
        }
        console.log('No payment preferences found for driver');
      } catch (e) {
        console.error('Error resolving driver payment preferences:', e);
      }
      const err = new Error('paymentMethod is required. Provide paymentMethod in request body or set a default payment preference');
      err.status = 400;
      throw err;
    }
    // Normalize for SantimPay API accepted values (broadened names/aliases)
    const normalizePaymentMethod = (method) => {
      const raw = String(method || "").trim();
      const m = raw.toLowerCase();
      const table = {
        telebirr: 'Telebirr', tele: 'Telebirr', 'tele-birr': 'Telebirr', 'tele birr': 'Telebirr',
        cbe: 'CBE', 'cbe-birr': 'CBE', cbebirr: 'CBE', 'cbe birr': 'CBE',
        'commercial bank of ethiopia (cbe)': 'CBE', 'commercial bank of ethiopia': 'CBE', 'commercial bank of ethiopia cbe': 'CBE',
        hellocash: 'HelloCash', 'hello-cash': 'HelloCash', 'hello cash': 'HelloCash',
        mpesa: 'MPesa', 'm-pesa': 'MPesa', 'm pesa': 'MPesa', 'm_pesa': 'MPesa',
        'bank of abyssinia': 'Abyssinia', abyssinia: 'Abyssinia',
        awash: 'Awash', 'awash bank': 'Awash',
        dashen: 'Dashen', 'dashen bank': 'Dashen',
        bunna: 'Bunna', 'bunna bank': 'Bunna',
        amhara: 'Amhara', 'amhara bank': 'Amhara',
        birhan: 'Birhan', 'birhan bank': 'Birhan',
        berhan: 'Berhan', 'berhan bank': 'Berhan',
        zamzam: 'ZamZam', 'zamzam bank': 'ZamZam',
        yimlu: 'Yimlu',
      };
      if (table[m]) return table[m];
      // Map any residual bank keyword to CBE rails as a fallback
      const bankKeywords = ['bank'];
      if (bankKeywords.some(k => m.includes(k))) return 'CBE';
      return raw; // pass-through for other configured options
    };

    const methodForGateway = normalizePaymentMethod(await resolvePaymentMethod());
    
    // Debug logging
    console.log('Topup request:', {
      userId,
      msisdn,
      methodForGateway,
      amount,
      reason
    });

    const notifyUrl =
      process.env.SANTIMPAY_NOTIFY_URL ||
      `${process.env.PUBLIC_BASE_URL || ""}/v1/wallet/webhook`;
    let gw;
    try {
      gw = await santim.directPayment({
        id: txId.toString(),
        amount,
        paymentReason: reason,
        notifyUrl,
        phoneNumber: msisdn,
        paymentMethod: methodForGateway,
      });
    } catch (err) {
      // Normalize gateway error message
      const raw = String(err && err.message ? err.message : err || '');
      let friendly = null;
      // Common pattern: 403 {"Reason":"payment method not supported"}
      const m1 = raw.match(/Reason\":\"([^\"]+)\"/i);
      if (m1 && m1[1]) friendly = m1[1];
      if (!friendly && /payment method not supported/i.test(raw)) friendly = 'payment method not supported';
      // Persist failure on transaction
      try {
        await Transaction.findByIdAndUpdate(txId, { status: 'failed', metadata: { gatewayError: raw } });
      } catch (_) {}
      const msg = friendly || 'payment failed';
      return res.status(400).json({ message: msg });
    }

    // Persist gateway response keys if present
    const gwTxnId =
      gw?.TxnId || gw?.txnId || gw?.data?.TxnId || gw?.data?.txnId;
    await Transaction.findByIdAndUpdate(txId, {
      txnId: gwTxnId || undefined,
      metadata: { ...tx.metadata, gatewayResponse: gw },
    });

    // Emit initial pending update over socket for realtime clients
    try {
      const { getIo, DEFAULT_OPS_ROOM } = require('../sockets/utils');
      const io = getIo && getIo();
      if (io) {
        const room = role === 'driver' ? `driver:${userId}` : (role === 'passenger' ? `passenger:${userId}` : null);
        const payload = { transactionId: txId.toString(), status: 'pending', amount, type: 'credit', method: 'santimpay', userId, role, msisdn, updatedAt: new Date(), reason };
        if (room) { try { io.to(room).emit('wallet:transaction_update', payload); } catch (_) {} }
        try { io.to(DEFAULT_OPS_ROOM).emit('wallet:transaction_update', payload); } catch (_) {}
      }
    } catch (_) {}

    return res.status(202).json({
      message: "Topup initiated",
      transactionId: txId.toString(),
      gatewayTxnId: gwTxnId,
    });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

exports.webhook = async (req, res) => {
  try {
    // Expect SantimPay to call with fields including txnId, Status, amount, reason, msisdn, refId, thirdPartyId
    const body = req.body || {};
    const data = body.data || body;
    // Debug log (can be toggled off via env)
    if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.log("[wallet-webhook] received:", data);
    }
    // Prefer the id we originally sent (provider echoes it as thirdPartyId). Do not use provider RefId as our id.
    const thirdPartyId =
      data.thirdPartyId ||
      data.ID ||
      data.id ||
      data.transactionId ||
      data.clientReference;
    const providerRefId = data.RefId || data.refId;
    const gwTxnId = data.TxnId || data.txnId;
    if (!thirdPartyId && !gwTxnId)
      return res.status(400).json({ message: "Invalid webhook payload" });

    let tx = null;
    // If thirdPartyId looks like an ObjectId, try findById
    if (thirdPartyId && mongoose.Types.ObjectId.isValid(String(thirdPartyId))) {
      tx = await Transaction.findById(thirdPartyId);
    }
    // Otherwise try our refId match (we set refId to our ObjectId string when creating the tx)
    if (!tx && thirdPartyId) {
      tx = await Transaction.findOne({ refId: String(thirdPartyId) });
    }
    // Fallback to gateway txnId
    if (!tx && gwTxnId) {
      tx = await Transaction.findOne({ txnId: String(gwTxnId) });
    }
    if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.log("[wallet-webhook] match:", {
        thirdPartyId,
        gwTxnId,
        providerRefId,
        found: !!tx,
        txId: tx ? String(tx._id) : null,
        statusBefore: tx ? tx.status : null,
      });
    }
    if (!tx) {
      // Always ACK to avoid provider retries, but indicate not found
      return res.status(200).json({
        ok: false,
        message: "Transaction not found for webhook",
        thirdPartyId,
        txnId: gwTxnId,
        providerRefId,
      });
    }

    // Robust status normalization to handle various providers
    const rawCandidates = [
      data.Status,
      data.status,
      data.paymentStatus,
      data.txnStatus,
      data.state,
      data.result,
      data.response,
      data.UpdateType,
    ]
      .filter((v) => v != null)
      .map((v) => String(v).toUpperCase());

    const codeCandidates = [
      data.statusCode,
      data.code,
      data.resultCode,
      data.responseCode,
    ]
      .filter((v) => v != null)
      .map((v) => String(v).toUpperCase());

    const successBool =
      String(data.success).toLowerCase() === "true" || data.success === true;

    const SUCCESS_SET = new Set([
      "OK",
      "COMPLETED",
      "SUCCESS",
      "APPROVED",
      "PAID",
      "SUCCESSFUL",
    ]);
    const FAILED_SET = new Set([
      "FAILED",
      "FAILURE",
      "DECLINED",
      "REJECTED",
      "ERROR",
      "EXPIRED",
      "TIMEOUT",
      "CANCELED",
      "CANCELLED",
      "REVERSED",
      "CHARGEBACK",
      "CHARGED_BACK",
    ]);

    let normalizedStatus = "pending";
    const rawStatusUpper = rawCandidates[0] || "";
    if (
      successBool ||
      rawCandidates.some((s) => SUCCESS_SET.has(s)) ||
      codeCandidates.some((s) => SUCCESS_SET.has(s))
    ) {
      normalizedStatus = "success";
    } else if (
      rawCandidates.some((s) => FAILED_SET.has(s)) ||
      codeCandidates.some((s) => FAILED_SET.has(s))
    ) {
      normalizedStatus = "failed";
    } else {
      const reasonMsg = String(
        data.StatusReason || data.message || data.reason || ""
      ).toLowerCase();
      if (
        /(fail|declin|reject|error|timeout|expired|cancel|reverse|chargeback)/.test(
          reasonMsg
        )
      ) {
        normalizedStatus = "failed";
      }
    }

    const previousStatus = tx.status;
    tx.txnId = gwTxnId || tx.txnId;
    // Keep our refId as initially set (our ObjectId), do not overwrite with provider's RefId
    tx.refId = tx.refId || (thirdPartyId && String(thirdPartyId));
    tx.status = normalizedStatus;
    // Numeric fields from provider
    const n = (v) => (v == null ? undefined : Number(v));
    tx.commission = n(data.commission) ?? n(data.Commission) ?? tx.commission;
    tx.totalAmount =
      n(data.totalAmount) ?? n(data.TotalAmount) ?? tx.totalAmount;
    tx.msisdn = data.Msisdn || data.msisdn || tx.msisdn;
    tx.metadata = {
      ...tx.metadata,
      webhook: data,
      raw: body,
      created_at: data.created_at,
      updated_at: data.updated_at,
      merId: data.merId,
      merName: data.merName,
      paymentVia: data.paymentVia || data.PaymentMethod,
      commissionAmountInPercent: data.commissionAmountInPercent,
      providerCommissionAmountInPercent: data.providerCommissionAmountInPercent,
      vatAmountInPercent: data.vatAmountInPercent || data.VatAmountInPercent,
      lotteryTax: data.lotteryTax,
      reason: data.reason,
      providerStatus: rawStatusUpper,
      providerCodes: codeCandidates,
      providerSuccessFlag: successBool,
    };
    tx.updatedAt = new Date();

    // Idempotency: if already final state, do not re-apply wallet mutation
    const wasFinal =
      previousStatus === "success" || previousStatus === "failed";
    await tx.save();
    // Reload the transaction to ensure we have a fresh Mongoose document instance
    try {
      tx = await Transaction.findById(tx._id);
    } catch (_) {}
    if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.log("[wallet-webhook] updated tx:", {
        txId: String(tx._id),
        statusAfter: tx.status,
      });
    }

    if (!wasFinal && (normalizedStatus === "success" || normalizedStatus === "failed")) {
      // For credits, prefer adjustedAmount (intended topup) then amount; for debits, prefer amount then adjustedAmount
      const providerAmount =
        tx.type === "credit"
          ? n(data.adjustedAmount) ?? n(data.amount) ?? tx.amount
          : n(data.amount) ?? n(data.adjustedAmount) ?? tx.amount;
      if (tx.type === "credit") {
        // If this is a provider deposit for drivers, convert to package using dynamic commissionRate
        let delta = providerAmount;
        try {
          const { Commission } = require("../models/commission");
          const financeService = require("../services/financeService");
          let commissionRate = Number(process.env.COMMISSION_RATE || 15);
          try {
            if (tx && tx.role === 'driver' && tx.userId) {
              const commissionDoc = await Commission.findOne({ driverId: String(tx.userId) }).sort({ createdAt: -1 });
              if (commissionDoc && Number.isFinite(commissionDoc.percentage)) {
                commissionRate = commissionDoc.percentage;
              }
            }
          } catch (_) {}
          if (tx.role === 'driver') {
            delta = financeService.calculatePackage(providerAmount, commissionRate);
          }
        } catch (_) {}
        await Wallet.updateOne(
          { userId: tx.userId, role: tx.role },
          { $inc: { balance: delta } },
          { upsert: true }
        );
      } else if (tx.type === "debit") {
        await Wallet.updateOne(
          { userId: tx.userId, role: tx.role },
          { $inc: { balance: -providerAmount } },
          { upsert: true }
        );
      }
      if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
        // eslint-disable-next-line no-console
        console.log("[wallet-webhook] wallet mutated:", {
          userId: tx.userId,
          role: tx.role,
          type: tx.type,
          delta: tx.type === "credit" ? providerAmount : -providerAmount,
        });
      }
      // Emit realtime transaction update for success/failure
      try {
        const { getIo, DEFAULT_OPS_ROOM } = require('../sockets/utils');
        const io = getIo && getIo();
        if (io) {
          const room = tx.role === 'driver' ? `driver:${tx.userId}` : (tx.role === 'passenger' ? `passenger:${tx.userId}` : null);
          const emitPayload = {
            transactionId: String(tx._id),
            status: normalizedStatus,
            amount: tx.amount,
            type: tx.type,
            method: tx.method,
            userId: tx.userId,
            role: tx.role,
            msisdn: tx.msisdn,
            txnId: tx.txnId,
            refId: tx.refId,
            updatedAt: tx.updatedAt
          };
          if (room) { try { io.to(room).emit('wallet:transaction_update', emitPayload); } catch (_) {} }
          try { io.to(DEFAULT_OPS_ROOM).emit('wallet:transaction_update', emitPayload); } catch (_) {}
        }
      } catch (_) {}
    }

    // Emit realtime transaction update to user and ops
    try {
      const { getIo, DEFAULT_OPS_ROOM } = require('../sockets/utils');
      const io = getIo && getIo();
      if (io) {
        const room = tx.role === 'driver' ? `driver:${tx.userId}` : (tx.role === 'passenger' ? `passenger:${tx.userId}` : null);
        const emitPayload = {
          transactionId: String(tx._id),
          status: tx.status,
          amount: tx.amount,
          type: tx.type,
          method: tx.method,
          userId: tx.userId,
          role: tx.role,
          msisdn: tx.msisdn,
          txnId: tx.txnId,
          refId: tx.refId,
          updatedAt: tx.updatedAt
        };
        if (room) { try { io.to(room).emit('wallet:transaction_update', emitPayload); } catch (_) {} }
        try { io.to(DEFAULT_OPS_ROOM).emit('wallet:transaction_update', emitPayload); } catch (_) {}
      }
    } catch (_) {}

    // Respond with normalized status so integrators see success/failed/pending clearly
    return res.status(200).json({
      ok: true,
      transactionId: String(tx._id),
      status: normalizedStatus,
      providerStatus: rawStatus,
      txnId: tx.txnId || data.TxnId || data.txnId,
      refId: tx.refId || data.RefId || data.refId,
      thirdPartyId,
      amountReported: data.amount || data.Amount || data.TotalAmount,
      currency: data.currency || data.Currency || "ETB",
      msisdn: tx.msisdn || data.Msisdn || data.msisdn,
      paymentVia: data.paymentVia || data.PaymentMethod,
      message: data.message || data.StatusReason,
      updateType: data.updateType || data.UpdateType,
      updatedAt: tx.updatedAt || new Date(),
      updatedBy: data.updatedBy || data.UpdatedBy,
    });
  } catch (e) {
    // Always ACK with ok=false to prevent retries storms; log error
    if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.error("[wallet-webhook] error:", e);
    }
    return res.status(200).json({ ok: false, error: e.message });
  }
};

exports.transactions = async (req, res) => {
  try {
    const userId = req.params.userId || req.user.id;
    const rows = await Transaction.find({ userId: String(userId) })
      .sort({ createdAt: -1 })
      .lean();
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

exports.withdraw = async (req, res) => {
  try {
    const {
      amount,
      destination,
      method = "santimpay",
      paymentMethod,
      reason = "Wallet Withdrawal",
    } = req.body || {};
    if (!amount || amount <= 0)
      return res.status(400).json({ message: "amount must be > 0" });

    const userId = String(req.user.id);
    const role = "driver";
    if (req.user.type !== "driver")
      return res.status(403).json({ message: "Only drivers can withdraw" });

    const wallet = await Wallet.findOne({ userId, role });
    if (!wallet || wallet.balance < amount)
      return res.status(400).json({ message: "Insufficient balance" });
    // We DO NOT deduct until provider confirms success via webhook
    const tx = await Transaction.create({
      userId,
      role,
      amount,
      type: "debit",
      method,
      status: "pending",
      metadata: { destination, reason },
    });

    // Normalize Ethiopian MSISDN
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
    // Kick off payout transfer
    const msisdn = normalizeMsisdnEt(
      destination || req.user.phone || req.user.phoneNumber
    );
    if (!msisdn)
      return res.status(400).json({ message: "Invalid destination phone" });
    const notifyUrl =
      process.env.SANTIMPAY_WITHDRAW_NOTIFY_URL ||
      `${process.env.PUBLIC_BASE_URL || ""}/v1/wallet/webhook`;
    try {
      // Resolve payment method from explicit param or driver's selected PaymentOption
      async function resolvePaymentMethodWithdraw() {
        const pick = (v) => (typeof v === 'string' && v.trim().length) ? v.trim() : null;
        const explicit = pick(paymentMethod);
        if (explicit) return explicit;
        try {
          const { Driver } = require("../models/userModels");
          const me = await Driver.findById(String(userId)).select({ paymentPreference: 1 }).populate({ path: 'paymentPreference', select: { name: 1 } });
          const name = me && me.paymentPreference && me.paymentPreference.name ? String(me.paymentPreference.name).trim() : null;
          if (name) return name;
        } catch (_) {}
        const err = new Error('paymentMethod is required. Provide paymentMethod in request body or set a default payment preference');
        err.status = 400;
        throw err;
      }
      const normalizePaymentMethod2 = (method) => normalizePaymentMethod(method);
      const pm = normalizePaymentMethod2(await resolvePaymentMethodWithdraw());
      const gw = await santim.payoutTransfer({
        id: tx._id.toString(),
        amount,
        paymentReason: reason,
        phoneNumber: msisdn,
        paymentMethod: pm,
        notifyUrl,
      });
      const gwTxnId =
        gw?.TxnId || gw?.txnId || gw?.data?.TxnId || gw?.data?.txnId;
      await Transaction.findByIdAndUpdate(tx._id, {
        txnId: gwTxnId,
        metadata: { ...tx.metadata, gatewayResponse: gw },
      });
    } catch (err) {
      await Transaction.findByIdAndUpdate(tx._id, {
        status: "failed",
        metadata: { ...tx.metadata, gatewayError: err.message },
      });
      return res
        .status(502)
        .json({ message: `Payout initiation failed: ${err.message}` });
    }

    return res.status(202).json({
      message: "Withdrawal initiated",
      transactionId: tx._id.toString(),
    });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};
