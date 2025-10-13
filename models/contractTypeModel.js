const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/dbconfig");

const ContractType = sequelize.define("ContractType", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 100]
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  base_price_per_km: {
    type: DataTypes.DECIMAL(8, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: {
      min: 0
    }
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
    validate: {
      min: 0
    }
  },
  maximum_passengers: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 1
    }
  },
  multiplier: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 1.00,
    validate: {
      min: 0.01
    },
    comment: "Multiplier for fare calculation (e.g., 1.0 for per trip, 7.0 for weekly, 30.0 for monthly)"
  },
  features: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: {},
    comment: "JSON object containing features like wifi, ac, etc."
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  created_by: {
    type: DataTypes.UUID,
    allowNull: true, // admin user id
  },
  updated_by: {
    type: DataTypes.UUID,
    allowNull: true, // admin user id
  },
}, {
  tableName: "contract_types",
  timestamps: true,
  indexes: []
});

module.exports = ContractType;
