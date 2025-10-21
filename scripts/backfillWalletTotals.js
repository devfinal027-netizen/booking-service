#!/usr/bin/env node
/*
Backfill driver Wallet.totalEarnings and (optionally) balance from historical data.
- Computes per-driver totals from Transactions (role=driver, type=credit) and DriverEarnings.netEarnings
- Prioritizes Transactions when present (these reflect actual wallet ops)
- If --includeNet flag is provided, also adds DriverEarnings.netEarnings to totalEarnings
- Never decreases totalEarnings; only sets to the computed sum when higher unless --force is passed

Usage:
  MONGO_URI=mongodb://... node scripts/backfillWalletTotals.js --dryRun
  MONGO_URI=mongodb://... node scripts/backfillWalletTotals.js --includeNet
  MONGO_URI=mongodb://... node scripts/backfillWalletTotals.js --force
*/

const mongoose = require('mongoose');
const { connectMongo } = require('../config/mongo');

async function main() {
  const dryRun = process.argv.includes('--dryRun');
  const includeNet = process.argv.includes('--includeNet');
  const force = process.argv.includes('--force');

  await connectMongo();

  const { Wallet, Transaction } = require('../models/common');
  const { DriverEarnings } = require('../models/commission');

  // Aggregate driver credit transactions
  const txAgg = await Transaction.aggregate([
    { $match: { role: 'driver', type: 'credit', status: 'success' } },
    { $group: { _id: '$userId', credits: { $sum: '$amount' }, count: { $sum: 1 } } }
  ]);
  const txMap = Object.fromEntries(txAgg.map(r => [String(r._id), { credits: r.credits || 0, count: r.count || 0 }]));

  let netMap = {};
  if (includeNet) {
    const netAgg = await DriverEarnings.aggregate([
      { $group: { _id: '$driverId', net: { $sum: '$netEarnings' }, rides: { $sum: 1 } } }
    ]);
    netMap = Object.fromEntries(netAgg.map(r => [String(r._id), { net: r.net || 0, rides: r.rides || 0 }]));
  }

  const driverIds = Array.from(new Set([...Object.keys(txMap), ...Object.keys(netMap)]));

  let updated = 0;
  let examined = 0;
  const changes = [];

  for (const driverId of driverIds) {
    examined++;
    const tx = txMap[driverId];
    const ne = netMap[driverId];
    const target = (tx?.credits || 0) + (ne?.net || 0);

    const wallet = await Wallet.findOne({ userId: driverId, role: 'driver' });
    const current = wallet ? Number(wallet.totalEarnings || 0) : 0;

    if (force ? (current !== target) : (target > current)) {
      if (!dryRun) {
        await Wallet.updateOne(
          { userId: driverId, role: 'driver' },
          { $set: { totalEarnings: target }, $setOnInsert: { balance: 0 } },
          { upsert: true }
        );
      }
      updated++;
      changes.push({ driverId, from: current, to: target });
    }
  }

  console.log(JSON.stringify({ examined, updated, includeNet, force, dryRun, changes: changes.slice(0, 50) }, null, 2));
  await mongoose.connection.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
