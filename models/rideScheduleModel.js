//models/rideScheduleModel.js
const { sequelize } = require("../config/dbconfig");
const { DataTypes } = require("sequelize");

const RideSchedule = sequelize.define(
  "RideSchedule",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    contract_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    driver_id: {
      type: DataTypes.UUID,
    },
    pickup_latitude: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    pickup_longitude: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    dropoff_latitude: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    dropoff_longitude: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    pattern_type: {
      type: DataTypes.ENUM("DAILY", "WEEKLY", "MONTHLY"),
      allowNull: false,
    },
    pickup_time: {
      type: DataTypes.TIME,
      allowNull: false,
    },
    days_of_week: {
      type: DataTypes.STRING(20),
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    status: {
      type: DataTypes.ENUM("COMPLETED", "CANCELLED", "NO_SHOW", "PENDING"),
      defaultValue: "PENDING",
    },
  },
  {
    tableName: "ride_schedules",
    timestamps: true,
  }
);

module.exports = RideSchedule;