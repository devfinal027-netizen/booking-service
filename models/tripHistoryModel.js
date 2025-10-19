// Wrapper to reuse existing TripHistory if available in bookingModels
try {
  const { TripHistory } = require('./bookingModels');
  module.exports = TripHistory;
} catch (e) {
  const mongoose = require('mongoose');

  const locationSubSchema = new mongoose.Schema(
    {
      lat: Number,
      // Accept both lon and lng for compatibility
      lon: Number,
      lng: Number,
      timestamp: Date,
      speed: Number,
      source: String,
    },
    { _id: false }
  );

  const tripHistorySchema = new mongoose.Schema(
    {
      bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
      driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Driver' },
      passengerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Passenger' },

      status: {
        type: String,
        enum: ['requested', 'accepted', 'ongoing', 'completed', 'canceled'],
        required: true,
      },

      // Incremental aggregates
      distanceAccumulatedKm: { type: Number, default: 0 },
      movingMinutes: { type: Number, default: 0 },
      waitingMinutes: { type: Number, default: 0 },

      // Legacy summary fields
      fare: Number,
      distance: Number,
      duration: Number,
      waitingTime: Number,
      vehicleType: String,

      // Life-cycle timestamps and locations
      startedAt: Date,
      completedAt: Date,
      startTime: Date,
      endTime: Date,

      pickupLocation: {
        latitude: Number,
        longitude: Number,
        address: String,
      },
      dropoffLocation: {
        latitude: Number,
        longitude: Number,
        address: String,
      },

      // Breadcrumbs
      locations: [locationSubSchema],
    },
    { timestamps: true }
  );

  // Helpful indexes
  tripHistorySchema.index({ bookingId: 1 });
  tripHistorySchema.index({ 'locations.timestamp': 1 });

  module.exports = mongoose.model('TripHistory', tripHistorySchema);
}

