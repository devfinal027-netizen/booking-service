const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/dbconfig");

const Pricing = sequelize.define("Pricing", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  contract_type: {
    type: DataTypes.ENUM("INDIVIDUAL", "GROUP", "INSTITUTIONAL"),
    allowNull: false,
  },
  price_per_km: {
    type: DataTypes.DECIMAL(8, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  base_fare: {
    type: DataTypes.DECIMAL(8, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  minimum_fare: {
    type: DataTypes.DECIMAL(8, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  effective_from: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  effective_until: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  created_by: {
    type: DataTypes.UUID,
    allowNull: true, // admin user id
  },
}, {
  tableName: "pricing",
  timestamps: true,
});

module.exports = Pricing;