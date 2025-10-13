//discountModel.js
const { sequelize } = require("../config/dbconfig");
const { DataTypes } = require("sequelize");

const Discount = sequelize.define(
  "Discount",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    discount_percentage: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0,
    },
    description: {
      type: DataTypes.TEXT,
    },
    status: {
      type: DataTypes.ENUM("APPLY", "UNAPPLY"),
      defaultValue: "UNAPPLY",
    },
  },
  {
    tableName: "discounts",
    timestamps: true,
  }
);

module.exports = Discount;
