'use strict';

// Expose models and convenience accessors for external services.
// NOTE: No normalization or transformation is applied here; raw DB entities are returned.

const { Passenger, Driver, Staff, Admin } = require('../models/userModels');

function getModels() {
  return { Passenger, Driver, Staff, Admin };
}

function getSequelize() {
  // This project uses Mongoose; Sequelize is not applicable.
  // Return null for compatibility with guide signature.
  return null;
}

async function findPassengerById(id) {
  if (id == null) return null;
  return Passenger.findById(id).lean();
}

async function findDriverById(id) {
  if (id == null) return null;
  return Driver.findById(id).lean();
}

async function findStaffById(id) {
  if (id == null) return null;
  return Staff.findById(id).lean();
}

async function findAdminById(id) {
  if (id == null) return null;
  return Admin.findById(id).lean();
}

module.exports = {
  getModels,
  getSequelize,
  findPassengerById,
  findDriverById,
  findStaffById,
  findAdminById,
};
