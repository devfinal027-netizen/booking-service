//models/paymentModel.js
const { sequelize } = require("../config/dbconfig");
const { DataTypes } = require("sequelize");

const Payment = sequelize.define(
  "Payment",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    subscription_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "subscriptions", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    contract_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "contracts", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    passenger_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    payment_method: {
      type: DataTypes.ENUM("BANK_TRANSFER", "MOBILE_MONEY", "CASH", "CARD", "TELEBIRR", "AMOLE", "CHAPA", "HELLO_CASH"),
    },
    due_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    receipt_image: {
      type: DataTypes.STRING(255),
    },
    transaction_reference: {
      type: DataTypes.STRING,
    },
    status: {
      type: DataTypes.ENUM("SUCCESS", "FAILED", "PENDING"),
      defaultValue: "PENDING",
    },
    admin_approved: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    approved_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    approved_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    rejection_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: "contract_payments",
    timestamps: true,
    updatedAt: false,
  }
);

module.exports = Payment;
