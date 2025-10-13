const { sequelize } = require("../config/dbconfig");
const { DataTypes } = require("sequelize");

const PaymentOption = sequelize.define(
  "PaymentOption",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    logo: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  },
  {
    tableName: "payment_options",
    timestamps: true,
    updatedAt: true,
  }
);

module.exports = PaymentOption;

