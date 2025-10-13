const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/dbconfig");

const Transaction = sequelize.define("Transaction", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  refId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    comment: "Our internal transaction reference ID",
  },
  txnId: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: "Gateway transaction ID from SantimPay",
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: "User ID from token service",
  },
  type: {
    type: DataTypes.ENUM("credit", "debit"),
    allowNull: false,
    comment: "Transaction type",
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: "Transaction amount",
  },
  commission: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: "Commission amount",
  },
  totalAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: "Total amount including commission",
  },
  method: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: "Payment method (Telebirr, CBE Birr, etc.)",
  },
  status: {
    type: DataTypes.ENUM("pending", "success", "failed", "cancelled"),
    allowNull: false,
    defaultValue: "pending",
    comment: "Transaction status",
  },
  msisdn: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: "Phone number used for payment",
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: "ETB",
    comment: "Currency code",
  },
  walletId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: "Foreign key to Wallet table",
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: "Additional transaction metadata (webhook data, etc.)",
  },
}, {
  tableName: "transactions",
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ["refId"],
      name: "unique_ref_id",
    },
    {
      fields: ["txnId"],
      name: "idx_txn_id",
    },
    {
      fields: ["userId"],
      name: "idx_user_id",
    },
    {
      fields: ["status"],
      name: "idx_status",
    },
    {
      fields: ["type"],
      name: "idx_type",
    },
    {
      fields: ["createdAt"],
      name: "idx_created_at",
    },
  ],
});

module.exports = Transaction;