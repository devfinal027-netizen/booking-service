//models/contractModel.js
const { sequelize } = require("../config/dbconfig");
const { DataTypes } = require("sequelize");

const Contract = sequelize.define(
  "Contract",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    discount_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "discounts",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    has_discount: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    contract_type_id: {
      type: DataTypes.UUID,
      allowNull: true, // Temporarily allow null for migration
      references: {
        model: "contract_types",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    },
    start_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    end_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    pickup_location: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    dropoff_location: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("ACTIVE", "INACTIVE"),
      defaultValue: "ACTIVE",
    },
    has_discount: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    cost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
  },
  {
    tableName: "contracts",
    timestamps: true,
  }
);

module.exports = Contract;
