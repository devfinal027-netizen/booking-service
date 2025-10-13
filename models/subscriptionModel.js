//models/subscriptionModel.js
const { sequelize } = require("../config/dbconfig");
const { DataTypes } = require("sequelize");

const Subscription = sequelize.define(
  "Subscription",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    contract_id: {
      type: DataTypes.UUID,
      allowNull: true, // Allow null when using contract types directly
      references: {
        model: 'contracts',
        key: 'id'
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    },
    passenger_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    passenger_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    passenger_phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    passenger_email: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    driver_id: {
      type: DataTypes.UUID,
      allowNull: true, // Assigned later by admin
    },
    driver_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    driver_phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    driver_email: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    vehicle_info: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    pickup_location: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    dropoff_location: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    pickup_latitude: {
      type: DataTypes.DECIMAL(10, 8),
      allowNull: true,
    },
    pickup_longitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: true,
    },
    dropoff_latitude: {
      type: DataTypes.DECIMAL(10, 8),
      allowNull: true,
    },
    dropoff_longitude: {
      type: DataTypes.DECIMAL(11, 8),
      allowNull: true,
    },
    contract_type_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'contract_types',
        key: 'id'
      },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    },
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    fare: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
    },
    discount_applied: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
    },
    final_fare: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
    },
    distance_km: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("PENDING", "ACTIVE", "COMPLETED", "CANCELLED"),
      defaultValue: "PENDING",
    },
    payment_status: {
      type: DataTypes.ENUM("PENDING", "PAID", "FAILED", "REFUNDED"),
      allowNull: true,
      defaultValue: null,
    },
    payment_reference: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "subscriptions",
    timestamps: true,
    updatedAt: true,
  }
);

module.exports = Subscription;