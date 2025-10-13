const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/dbconfig");

const TripSchedule = sequelize.define("TripSchedule", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  trip_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  scheduled_time: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  notified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  notification_sent_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  notification_type: {
    type: DataTypes.ENUM("ARRIVAL", "DEPARTURE", "DELAY", "CANCELLATION"),
    defaultValue: "ARRIVAL",
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: "trip_schedules",
  timestamps: true,
});

module.exports = TripSchedule;