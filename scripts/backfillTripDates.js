#!/usr/bin/env node
/*
Backfill script:
- Align AdminEarnings.tripDate and DriverEarnings.tripDate to Booking.completedAt
- Optionally fix gross/commission from Booking where diverged
Usage:
  MONGO_URI=mongodb://... node scripts/backfillTripDates.js --dryRun
Options:
  --dryRun: only logs counts, does not modify data
  --fixAmounts: also overwrite grossFare/commissionEarned from Booking
*/

const mongoose = require('mongoose');
const { connectMongo } = require('../config/mongo');
const { Booking } = require('../models/bookingModels');
const { AdminEarnings, DriverEarnings } = require('../models/commission');

async function main() {
  const dryRun = process.argv.includes('--dryRun');
  const fixAmounts = process.argv.includes('--fixAmounts');

  await connectMongo();

  const cursor = AdminEarnings.find({}).cursor();
  let updatedTripDates = 0;
  let mismatchedAmounts = 0;

  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    const ae = doc;
    const booking = await Booking.findById(ae.bookingId).lean();
    if (!booking || !booking.completedAt) continue;

    // Backfill tripDate
    if (!ae.tripDate || Math.abs(new Date(ae.tripDate).getTime() - new Date(booking.completedAt).getTime()) > 1000) {
      updatedTripDates++;
      if (!dryRun) {
        await AdminEarnings.updateOne({ _id: ae._id }, { $set: { tripDate: booking.completedAt } });
      }
    }

    // Optional amount fixes
    if (fixAmounts) {
      const shouldFixGross = typeof booking.fareFinal === 'number' && booking.fareFinal !== ae.grossFare;
      const shouldFixCommission = typeof booking.commissionAmount === 'number' && booking.commissionAmount !== ae.commissionEarned;
      if (shouldFixGross || shouldFixCommission) {
        mismatchedAmounts++;
        if (!dryRun) {
          await AdminEarnings.updateOne({ _id: ae._id }, {
            $set: {
              ...(shouldFixGross ? { grossFare: booking.fareFinal } : {}),
              ...(shouldFixCommission ? { commissionEarned: booking.commissionAmount } : {})
            }
          });
        }
      }
    }
  }

  // DriverEarnings tripDate backfill
  const deCursor = DriverEarnings.find({}).cursor();
  let updatedDriverTripDates = 0;
  for (let doc = await deCursor.next(); doc != null; doc = await deCursor.next()) {
    const de = doc;
    const booking = await Booking.findById(de.bookingId).lean();
    if (!booking || !booking.completedAt) continue;
    if (!de.tripDate || Math.abs(new Date(de.tripDate).getTime() - new Date(booking.completedAt).getTime()) > 1000) {
      updatedDriverTripDates++;
      if (!dryRun) {
        await DriverEarnings.updateOne({ _id: de._id }, { $set: { tripDate: booking.completedAt } });
      }
    }
  }

  console.log(JSON.stringify({ updatedTripDates, mismatchedAmounts, updatedDriverTripDates, dryRun, fixAmounts }, null, 2));
  await mongoose.connection.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
