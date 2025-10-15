const { randomUUID } = require("crypto");
const santim = require("../utils/santimpay");
const { Wallet, Transaction } = require("../models/indexModel");

/**
 * Normalize various Ethiopian mobile formats to E.164 (+251XXXXXXXXX)
 * Accepts:
 * - 09XXXXXXXX
 * - 07XXXXXXXX
 * - 2519XXXXXXXX
 * - 2517XXXXXXXX
 * - +2519XXXXXXXX
 * - +2517XXXXXXXX
 * Returns string like "+2519XXXXXXXX" or "+2517XXXXXXXX"
 */
function normalizeMsisdnEt(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/\s+/g, "").replace(/[-()]/g, "");

  // Combined regex for both 09 and 07 prefixes (Ethio Telecom and Safaricom Ethiopia)
  // ^(?:\+251|251|0)?([79]\d{8})$
  // - ^           : start of the string
  // - (?:\+251|251|0)? : optional non-capturing group for prefix (+251, 251, or 0)
  // - ([79]\d{8}) : capturing group for the 9-digit number starting with 7 or 9
  // - $           : end of the string
  const match = s.match(/^(?:\+251|251|0)?([79]\d{8})$/);

  if (match) {
    return "+251" + match[1]; // Prepend +251 to the captured 9-digit number
  }
  
  // If it doesn't match any valid Ethiopian mobile pattern, return null
  return null;
}

function normalizePaymentMethod(method) {
  const raw = String(method || "").trim();
  const m = raw.toLowerCase();
  const table = {
    telebirr: 'Telebirr', tele: 'Telebirr', 'tele-birr': 'Telebirr', 'tele birr': 'Telebirr',
    cbe: 'CBE', 'cbe-birr': 'CBE', cbebirr: 'CBE', 'cbe birr': 'CBE',
    'commercial bank of ethiopia (cbe)': 'CBE', 'commercial bank of ethiopia': 'CBE', 'commercial bank of ethiopia cbe': 'CBE',
    hellocash: 'HelloCash', 'hello-cash': 'HelloCash', 'hello cash': 'HelloCash',
    mpesa: 'MPesa', 'm-pesa': 'MPesa', 'm pesa': 'MPesa', 'm_pesa': 'MPesa',
    safaricom: 'Safaricom', 'safaricom ethiopia': 'Safaricom', 'safaricom_et': 'Safaricom',
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
  const bankKeywords = ['bank'];
  if (bankKeywords.some(k => m.includes(k))) return 'CBE';
  return raw;
}

exports.topup = async (req, res) => {
  try {
    const { amount, paymentMethod, reason = "Wallet Topup" } = req.body || {};
    if (!amount || amount <= 0) return res.status(400).json({ message: "amount must be > 0" });

    const tokenPhone = req.user && (req.user.phone || req.user.phoneNumber || req.user.mobile);
    if (!tokenPhone) return res.status(400).json({ message: "phoneNumber missing in token" });

    const msisdn = normalizeMsisdnEt(tokenPhone);
    if (!msisdn) return res.status(400).json({ message: "Invalid phone format in token. Required: +2517XXXXXXXX or +2519XXXXXXXX" }); // Updated error message

    const userId = String(req.user.id);

    let wallet = await Wallet.findOne({ where: { userId } });
    if (!wallet) wallet = await Wallet.create({ userId, balance: 0 });

    const txId = randomUUID();
    const tx = await Transaction.create({ 
      refId: String(txId), 
      userId, 
      amount, 
      type: "credit", 
      method: "santimpay", 
      status: "pending", 
      msisdn, 
      walletId: wallet.id,
      metadata: { reason } 
    });

    let methodForGateway = null;
    
    const pick = (v) => (typeof v === 'string' && v.trim().length) ? v.trim() : null;
    
    const explicit = pick(paymentMethod);
    if (explicit) {
      console.log('Using explicit payment method:', explicit);
      methodForGateway = normalizePaymentMethod(explicit);
    }
    
    if (!methodForGateway && req.body && req.body.payment_option_id) {
      try {
        const { PaymentOption } = require("../models/indexModel");
        const opt = await PaymentOption.findByPk(String(req.body.payment_option_id));
        if (opt && opt.name) {
          console.log('Using payment option from request:', opt.name);
          methodForGateway = normalizePaymentMethod(opt.name);
        }
      } catch (e) {
        console.error('Error resolving payment option from request:', e);
      }
    }
    
    if (!methodForGateway) {
      try {
        console.log('User payment preferences not implemented yet');
      } catch (e) {
        console.error('Error resolving user payment preferences:', e);
      }
    }
    
    if (!methodForGateway) {
      const err = new Error('paymentMethod is required and no payment preference is set');
      err.status = 400;
      throw err;
    }

    const notifyUrl = process.env.SANTIMPAY_NOTIFY_URL || `${process.env.PUBLIC_BASE_URL || ""}/wallet/webhook`;
    let gw;
    try {
      gw = await santim.directPayment({ id: String(txId), amount, paymentReason: reason, notifyUrl, phoneNumber: msisdn, paymentMethod: methodForGateway });
    } catch (err) {
      await Transaction.update(
        { status: 'failed', metadata: { gatewayError: String(err && err.message || err) } },
        { where: { refId: String(txId) } }
      );
      return res.status(400).json({ message: err && err.message ? err.message : 'payment failed' });
    }

    const gwTxnId = gw?.TxnId || gw?.txnId || gw?.data?.TxnId || gw?.data?.txnId;
    await Transaction.update(
      { txnId: gwTxnId, metadata: { ...tx.metadata, gatewayResponse: gw } },
      { where: { refId: String(txId) } }
    );

    return res.status(202).json({ message: "Topup initiated", transactionId: String(txId), gatewayTxnId: gwTxnId });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

exports.webhook = async (req, res) => {
  try {
    const body = req.body || {};
    const data = body.data || body;
    if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
      console.log("[wallet-webhook] received:", data);
    }
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
    if (thirdPartyId) {
      tx = await Transaction.findOne({ where: { refId: String(thirdPartyId) } });
    }
    if (!tx && gwTxnId) {
      tx = await Transaction.findOne({ where: { txnId: String(gwTxnId) } });
    }
    if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
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
      try {
        const { Subscription } = require("../models/indexModel");
        const rawStatus = (data.Status || data.status || "").toString().toUpperCase();
        const success = ["COMPLETED", "SUCCESS", "APPROVED"].includes(rawStatus);
        let subscription = null;
        if (thirdPartyId) subscription = await Subscription.findByPk(String(thirdPartyId));
        if (!subscription && gwTxnId) subscription = await Subscription.findOne({ where: { payment_reference: String(gwTxnId) } });
        if (subscription) {
          const update = success ? { payment_status: "PAID", status: "ACTIVE", payment_reference: gwTxnId || subscription.payment_reference } : { payment_status: "FAILED", payment_reference: gwTxnId || subscription.payment_reference };
          await Subscription.update(update, { where: { id: subscription.id } });
          return res.status(200).json({ ok: true, subscription_id: subscription.id, status: success ? "PAID" : "FAILED", gatewayTxnId: gwTxnId, shared: true });
        }
      } catch (_) {}
      return res.status(200).json({
        ok: false,
        message: "Transaction not found for webhook",
        thirdPartyId,
        txnId: gwTxnId,
        providerRefId,
      });
    }

    const rawStatus = (data.Status || data.status || "")
      .toString()
      .toUpperCase();
    const normalizedStatus = ["COMPLETED", "SUCCESS", "APPROVED"].includes(
      rawStatus
    )
      ? "success"
      : ["FAILED", "CANCELLED", "DECLINED"].includes(rawStatus)
      ? "failed"
      : "pending";

    const previousStatus = tx.status;
    tx.txnId = gwTxnId || tx.txnId;
    tx.refId = tx.refId || (thirdPartyId && String(thirdPartyId));
    tx.status = normalizedStatus;
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
    };
    tx.updatedAt = new Date();

    const wasFinal =
      previousStatus === "success" || previousStatus === "failed";
    await tx.save();
    if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
      console.log("[wallet-webhook] updated tx:", {
        txId: String(tx._id),
        statusAfter: tx.status,
      });
    }

    if (!wasFinal && normalizedStatus === "success") {
      const providerAmount =
        tx.type === "credit"
          ? n(data.adjustedAmount) ?? n(data.amount) ?? tx.amount
          : n(data.amount) ?? n(data.adjustedAmount) ?? tx.amount;
      
      let wallet = await Wallet.findOne({ where: { userId: tx.userId } });
      if (!wallet) {
        wallet = await Wallet.create({ userId: tx.userId, balance: 0 });
      }
      
      if (tx.type === "credit") {
        await wallet.update({ balance: parseFloat(wallet.balance) + providerAmount });
      } else if (tx.type === "debit") {
        await wallet.update({ balance: parseFloat(wallet.balance) - providerAmount });
      }
      
      if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
        console.log("[wallet-webhook] wallet mutated:", {
          userId: tx.userId,
          type: tx.type,
          delta: tx.type === "credit" ? providerAmount : -providerAmount,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      txnId: data.TxnId || data.txnId,
      refId: data.RefId || data.refId,
      thirdPartyId: data.thirdPartyId,
      status: data.Status || data.status,
      statusReason: data.StatusReason || data.message,
      amount: data.amount || data.Amount || data.TotalAmount,
      currency: data.currency || data.Currency || "ETB",
      msisdn: data.Msisdn || data.msisdn,
      paymentVia: data.paymentVia || data.PaymentMethod,
      message: data.message,
      updateType: data.updateType || data.UpdateType,
      updatedAt: new Date(),
      updatedBy: data.updatedBy || data.UpdatedBy,
    });
  } catch (e) {
    if (process.env.WALLET_WEBHOOK_DEBUG === "1") {
      console.error("[wallet-webhook] error:", e);
    }
    return res.status(200).json({ ok: false, error: e.message });
  }
};

exports.getBalance = async (req, res) => {
  try {
    const userId = String(req.user.id);
    const wallet = await Wallet.findOne({ where: { userId } });
    
    if (!wallet) {
      return res.json({ 
        balance: 0, 
        currency: "ETB",
        userId 
      });
    }
    
    return res.json({ 
      balance: parseFloat(wallet.balance),
      currency: wallet.currency,
      userId,
      lastTransactionAt: wallet.lastTransactionAt
    });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

exports.transactions = async (req, res) => {
  try {
    const userId = req.params.userId || req.user.id;
    const rows = await Transaction.findAll({ 
      where: { userId: String(userId) },
      order: [['createdAt', 'DESC']]
    });
    return res.json(rows);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

exports.adminBalances = async (req, res) => {
  try {
    if (req.user.type !== 'admin') return res.status(403).json({ message: 'Access denied' });
    const wallets = await Wallet.findAll({
      where: { isActive: true },
      attributes: ['userId', 'balance', 'currency', 'lastTransactionAt']
    });
    return res.json({ balances: wallets });
  } catch (e) { return res.status(500).json({ message: e.message }); }
};

exports.adminTransactions = async (req, res) => {
  try {
    if (req.user.type !== 'admin') return res.status(403).json({ message: 'Access denied' });
    const rows = await Transaction.findAll({
      order: [['createdAt', 'DESC']],
      include: [{
        model: Wallet,
        as: 'wallet',
        attributes: ['userId']
      }]
    });
    return res.json({ transactions: rows });
  } catch (e) { return res.status(500).json({ message: e.message }); }
};

exports.withdraw = async (req, res) => {
  try {
    return res.status(501).json({ message: "Withdraw not implemented" });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

exports.debug = async (req, res) => {
  try {
    const wallets = await Wallet.findAll();
    const transactions = await Transaction.findAll({
      order: [['createdAt', 'DESC']],
      limit: 50
    });
    
    return res.json({
      wallets,
      transactions,
      walletCount: wallets.length,
      transactionCount: transactions.length
    });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};