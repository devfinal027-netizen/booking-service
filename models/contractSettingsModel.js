const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/dbconfig");

const ContractSettings = sequelize.define("ContractSettings", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  contract_type: {
    type: DataTypes.ENUM("INDIVIDUAL", "GROUP", "INSTITUTIONAL"),
    allowNull: false,
    unique: true,
  },
  base_price_per_km: {
    type: DataTypes.DECIMAL(8, 2),
    allowNull: false,
    defaultValue: 0.00,
  },
  discount_percentage: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: {
      min: 0,
      max: 100,
    },
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
  created_by: {
    type: DataTypes.UUID,
    allowNull: true, // admin user id
  },
}, {
  tableName: "contract_settings",
  timestamps: true,
});

module.exports = ContractSettings;