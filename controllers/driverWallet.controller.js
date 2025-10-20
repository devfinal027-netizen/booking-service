const mongoose = require('mongoose');
const { Wallet, Transaction } = require('../models/common');

exports.getWallet = async (req, res) => {
  try {
    const driverId = req.params.id;
    console.log('[wallet] getWallet for driver:', String(driverId));
    const wallet = await Wallet.findOne({ userId: String(driverId), role: 'driver' }).lean();
    return res.json(wallet || { userId: String(driverId), role: 'driver', balance: 0, totalEarnings: 0, currency: 'ETB' });
  } catch (e) { return res.status(500).json({ message: e.message }); }
};

exports.adjustBalance = async (req, res) => {
  try {
    const driverId = req.params.id;
    const { amount, reason = 'Admin Adjustment' } = req.body || {};
    if (!amount || amount === 0) return res.status(400).json({ message: 'amount must be non-zero' });

    const txType = amount > 0 ? 'credit' : 'debit';
    const absAmount = Math.abs(Number(amount));

    const session = await mongoose.startSession();
    let out;
    await session.withTransaction(async () => {
      console.log('[wallet-admin] adjustBalance start:', { driverId: String(driverId), amount: Number(amount), reason });

      // Create transaction record for audit
      const tx = await Transaction.create([
        {
          userId: String(driverId),
          role: 'driver',
          amount: absAmount,
          type: txType,
          method: 'cash',
          status: 'success',
          metadata: { reason, operationType: 'adjustment' }
        }
      ], { session });
      const txDoc = Array.isArray(tx) ? tx[0] : tx;

      // Update wallet balance
      const update = amount > 0 ? { $inc: { balance: absAmount } } : { $inc: { balance: -absAmount } };
      const wallet = await Wallet.findOneAndUpdate(
        { userId: String(driverId), role: 'driver' },
        update,
        { new: true, upsert: true, session }
      );

      console.log('[wallet-admin] adjustBalance completed:', { driverId: String(driverId), newBalance: wallet.balance, transactionId: String(txDoc._id) });
      out = { wallet, transactionId: String(txDoc._id) };
    });
    session.endSession();
    return res.json(out);
  } catch (e) { return res.status(500).json({ message: e.message }); }
};

exports.listTransactions = async (req, res) => {
  try {
    const driverId = req.params.id;
    console.log('[wallet] listTransactions for driver:', String(driverId));
    const rows = await Transaction.find({ userId: String(driverId), role: 'driver' }).sort({ createdAt: -1 }).lean();
    return res.json(rows);
  } catch (e) { return res.status(500).json({ message: e.message }); }
};

// Withdraw funds: POST /drivers/:id/wallet/withdraw
exports.withdraw = async (req, res) => {
  try {
    const driverId = req.params.id;
    const { amount, destination, method = 'cash' } = req.body || {};
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ message: 'amount must be > 0' });

    const session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      console.log('[wallet] withdraw start:', { driverId: String(driverId), amount: amt, destination, method });
      const wallet = await Wallet.findOne({ userId: String(driverId), role: 'driver' }).session(session);
      if (!wallet || wallet.balance < amt) throw new Error('Insufficient balance');

      const updated = await Wallet.findOneAndUpdate(
        { userId: String(driverId), role: 'driver' },
        { $inc: { balance: -amt } },
        { new: true, session }
      );
      const tx = await Transaction.create([
        { userId: String(driverId), role: 'driver', amount: amt, type: 'debit', method, status: 'success', metadata: { destination, operationType: 'withdrawal' } }
      ], { session });
      const txDoc = Array.isArray(tx) ? tx[0] : tx;
      console.log('[wallet] withdraw completed:', { driverId: String(driverId), newBalance: updated.balance, transactionId: String(txDoc._id) });
      result = { wallet: updated, transactionId: String(txDoc._id) };
    });
    session.endSession();
    return res.json(result);
  } catch (e) {
    const code = /insufficient/i.test(String(e.message)) ? 400 : 500;
    return res.status(code).json({ message: e.message });
  }
};

// Admin: list all driver wallets with optional filters
exports.adminListWallets = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '50', 10), 1), 200);
    const skip = (page - 1) * pageSize;
    const minBalance = req.query.minBalance != null ? Number(req.query.minBalance) : undefined;
    const driverId = req.query.driverId ? String(req.query.driverId) : undefined;

    const filter = { role: 'driver' };
    if (driverId) filter.userId = driverId;
    if (Number.isFinite(minBalance)) filter.balance = { $gte: minBalance };

    console.log('[wallet-admin] list wallets filter:', filter);
    const [items, total] = await Promise.all([
      Wallet.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(pageSize).lean(),
      Wallet.countDocuments(filter),
    ]);

    // Enrich with driver user info (name, phone) from local DB and external service
    let enriched = items.map(w => ({ ...w, user: { id: String(w.userId) } }));
    try {
      const { Driver } = require('../models/userModels');
      const { Types } = require('mongoose');
      const driverIds = [...new Set(items.map(w => String(w.userId)).filter(Boolean))];
      const validIds = driverIds.filter(id => Types.ObjectId.isValid(id));
      const driversById = validIds.length ? await Driver.find({ _id: { $in: validIds } }).select({ _id: 1, name: 1, phone: 1, email: 1 }).lean() : [];
      const dmapById = Object.fromEntries(driversById.map(d => [String(d._id), { id: String(d._id), name: d.name, phone: d.phone, email: d.email }]));

      // Map local by externalId for non-ObjectId userIds
      const nonObjectIds = driverIds.filter(id => !Types.ObjectId.isValid(id));
      const driversByExternal = nonObjectIds.length ? await Driver.find({ externalId: { $in: nonObjectIds } }).select({ _id: 1, externalId: 1, name: 1, phone: 1, email: 1 }).lean() : [];
      const dmapByExternal = Object.fromEntries(driversByExternal.map(d => [String(d.externalId), { id: String(d._id), name: d.name, phone: d.phone, email: d.email, externalId: String(d.externalId) }]));

      enriched = enriched.map(w => ({
        ...w,
        user: dmapById[String(w.userId)] || dmapByExternal[String(w.userId)] || w.user
      }));

      // For any remaining without user details, fetch from external service in batch
      const unresolved = enriched.filter(e => !e.user || !e.user.name).map(e => String(e.userId || e.user?.id)).filter(Boolean);
      const uniqueUnresolved = [...new Set(unresolved)];
      if (uniqueUnresolved.length) {
        try {
          const { getDriversByIds } = require('../integrations/userServiceClient');
          const headers = req.headers && req.headers.authorization ? { Authorization: req.headers.authorization } : undefined;
          const infos = await getDriversByIds(uniqueUnresolved, { headers });
          const imap = Object.fromEntries((infos || []).map(i => [String(i.id), { id: String(i.id), name: i.name, phone: i.phone, email: i.email }]));
          enriched = enriched.map(w => ({
            ...w,
            user: (w.user && w.user.name) ? w.user : (imap[String(w.userId)] || w.user)
          }));
        } catch (_) {}
      }
    } catch (_) {}

    // Ensure totalEarnings exists and embed driver fields directly in wallet objects
    let itemsOut = [];
    try {
      // Precompute credits per driver for backfilling totals
      const driverIds = enriched.map(w => String(w.userId));
      const creditAgg = await Transaction.aggregate([
        { $match: { userId: { $in: driverIds }, role: 'driver', type: 'credit', status: 'success' } },
        { $group: { _id: '$userId', total: { $sum: '$amount' } } }
      ]);
      const creditsMap = Object.fromEntries(creditAgg.map(r => [String(r._id), Number(r.total || 0)]));

      itemsOut = enriched.map(w => {
        const { user, ...rest } = w;
        let out = { ...rest };
        if (!Number.isFinite(Number(out.totalEarnings))) {
          out.totalEarnings = creditsMap[String(out.userId)] || 0;
        }
        const d = user || {};
        out = { ...out, id: d.id || String(out.userId) };
        if (d.name) out.name = d.name;
        if (d.phone) out.phone = d.phone;
        if (d.email) out.email = d.email;
        return out;
      });
    } catch (_) {
      itemsOut = enriched.map(w => {
        const { user, ...rest } = w;
        return { ...rest, id: user?.id || String(rest.userId), totalEarnings: Number(rest.totalEarnings || 0) };
      });
    }

    return res.json({ items: itemsOut, page, pageSize, total });
  } catch (e) { return res.status(500).json({ message: e.message }); }
};

// Admin: get driver wallet and transactions
exports.adminGetDriverWallet = async (req, res) => {
  try {
    const driverId = String(req.params.driverId);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10), 1), 500);
  const [wallet, txs] = await Promise.all([
      Wallet.findOne({ userId: driverId, role: 'driver' }).lean(),
      Transaction.find({ userId: driverId, role: 'driver' }).sort({ createdAt: -1 }).limit(limit).lean(),
    ]);
    // Compute driver details (name, phone, email) from local DB or external service
    let driver = undefined;
    try {
      const { Driver } = require('../models/userModels');
      // Driver _id is a string in this codebase
      const d = await Driver.findById(driverId).select({ _id: 1, name: 1, phone: 1, email: 1 }).lean();
      if (d) driver = { id: String(d._id), name: d.name, phone: d.phone, email: d.email };
      if (!driver) {
        const de = await Driver.findOne({ externalId: String(driverId) }).select({ _id: 1, name: 1, phone: 1, email: 1, externalId: 1 }).lean();
        if (de) driver = { id: String(de._id), name: de.name, phone: de.phone, email: de.email, externalId: String(de.externalId) };
      }
    } catch (_) {}
    if (!driver) {
      try {
        const { getDriverById } = require('../integrations/userServiceClient');
        const headers = req.headers && req.headers.authorization ? { Authorization: req.headers.authorization } : undefined;
        const info = await getDriverById(driverId, { headers });
        if (info) driver = { id: String(info.id), name: info.name, phone: info.phone, email: info.email };
      } catch (_) {}
    }

    // Ensure wallet.totalEarnings is present; if missing, backfill from successful driver credit transactions
    let walletOut = wallet || { userId: driverId, role: 'driver', balance: 0, currency: 'ETB' };
    if (!Number.isFinite(Number(walletOut.totalEarnings))) {
      try {
        const agg = await Transaction.aggregate([
          { $match: { userId: driverId, role: 'driver', type: 'credit', status: 'success' } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        walletOut = { ...walletOut, totalEarnings: Number(agg[0]?.total || 0) };
      } catch (_) {
        walletOut = { ...walletOut, totalEarnings: 0 };
      }
    }

    const walletWithDriver = {
      ...walletOut,
      ...(driver ? { id: driver.id, name: driver.name, phone: driver.phone, email: driver.email } : { id: driverId })
    };
    return res.json({ wallet: walletWithDriver, transactions: txs });
  } catch (e) { return res.status(500).json({ message: e.message }); }
};
