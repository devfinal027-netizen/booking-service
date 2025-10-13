// config/dbconfig.js
const { Sequelize } = require("sequelize");
const mysql = require("mysql2/promise");
require("dotenv").config();

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

// ✅ Function to create database with utf8mb4
const createDatabase = async () => {
  try {
    const connection = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
    });

    // ✅ Create with utf8mb4
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );

    console.log(`✅ Database '${DB_NAME}' is ready.`);
    await connection.end();
  } catch (error) {
    console.error("❌ Database creation failed:", error.message);
    throw error;
  }
};

// ✅ Initialize Sequelize with utf8mb4
const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  dialect: "mysql",
  logging: false,
  dialectOptions: {
    charset: "utf8mb4",
  },
  define: {
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
  },
});

module.exports = { sequelize, createDatabase };
