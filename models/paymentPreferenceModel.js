const { sequelize } = require("../config/dbconfig");
const { DataTypes } = require("sequelize");

const PaymentPreference = sequelize.define(
  "PaymentPreference",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    user_type: {
      type: DataTypes.ENUM("passenger", "driver", "admin"),
      allowNull: false,
    },
    payment_option_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    }
  },
  {
    tableName: "payment_preferences",
    timestamps: true,
    updatedAt: true,
    indexes: [
      { unique: true, fields: ["user_id", "user_type", "payment_option_id"] }
    ]
  }
);

module.exports = PaymentPreference;

