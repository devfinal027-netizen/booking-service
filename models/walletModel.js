const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/dbconfig");

const Wallet = sequelize.define("Wallet", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    comment: "User ID from token service",
  },
  balance: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: "Current wallet balance",
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: "ETB",
    comment: "Currency code",
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: "Whether wallet is active",
  },
  lastTransactionAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: "Last transaction timestamp",
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: "Additional wallet metadata",
  },
}, {
  tableName: "wallets",
  timestamps: true,
  indexes: [
    {
      fields: ["userId"],
      name: "idx_user_id",
    },
    {
      fields: ["isActive"],
      name: "idx_is_active",
    },
  ],
});

module.exports = Wallet;