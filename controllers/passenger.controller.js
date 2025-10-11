const passengerService = require('../services/passengerService');
const errorHandler = require('../utils/errorHandler');
const logger = require('../utils/logger');

exports.create = async (req, res) => {
  try {
    return res.status(501).json({ message: 'Passenger creation is managed by the external user service.' });
  } catch (e) { errorHandler(res, e); }
};

exports.list = async (req, res) => {
  try {
    const { listPassengers } = require('../integrations/userServiceClient');
    const headers = req.headers && req.headers.authorization ? { Authorization: req.headers.authorization } : undefined;
    logger.info('[passengers.list] forwarding to external service', { query: req.query, hasAuth: !!headers });
    const rows = await listPassengers(req.query || {}, { headers });
    logger.info('[passengers.list] external response count', { count: Array.isArray(rows) ? rows.length : -1 });
    return res.json(rows);
  } catch (e) { errorHandler(res, e); }
};

exports.get = async (req, res) => {
  try {
    const { getPassengerById } = require('../integrations/userServiceClient');
    const paramId = String(req.params.id || '');
    let externalId = paramId;
    try {
      const { Types } = require('mongoose');
      if (Types.ObjectId.isValid(paramId)) {
        const { Passenger } = require('../models/userModels');
        const row = await Passenger.findById(paramId).select({ externalId: 1 }).lean();
        if (row && row.externalId) externalId = String(row.externalId);
      }
    } catch (_) {}
    const headers = req.headers && req.headers.authorization ? { Authorization: req.headers.authorization } : undefined;
    logger.info('[passengers.get] resolving id', { paramId, externalId, hasAuth: !!headers });
    const info = await getPassengerById(externalId, { headers });
    logger.info('[passengers.get] external response', { found: !!info, id: externalId });
    if (!info) return res.status(404).json({ message: 'Passenger not found' });
    return res.json(info);
  } catch (e) { errorHandler(res, e); }
};

exports.update = async (req, res) => {
  try {
    return res.status(501).json({ message: 'Passenger updates are managed by the external user service.' });
  } catch (e) { errorHandler(res, e); }
};

exports.remove = async (req, res) => {
  try {
    return res.status(501).json({ message: 'Passenger deletion is managed by the external user service.' });
  } catch (e) { errorHandler(res, e); }
};

exports.getMyProfile = async (req, res) => {
  try {
    if (req.user.type !== 'passenger') return res.status(403).json({ message: 'Only passengers can access this endpoint' });
    const { getPassengerById } = require('../integrations/userServiceClient');
    const headers = req.headers && req.headers.authorization ? { Authorization: req.headers.authorization } : undefined;
    logger.info('[passengers.me] fetching external profile', { userId: String(req.user.id), hasAuth: !!headers });
    const passenger = await getPassengerById(String(req.user.id), { headers });
    if (!passenger) return res.status(404).json({ message: 'Passenger not found' });
    return res.json(passenger);
  } catch (e) { errorHandler(res, e); }
};

exports.updateMyProfile = async (req, res) => {
  try {
    return res.status(501).json({ message: 'Profile updates are managed by the external user service.' });
  } catch (e) { errorHandler(res, e); }
};

exports.deleteMyAccount = async (req, res) => {
  try {
    return res.status(501).json({ message: 'Account deletion is managed by the external user service.' });
  } catch (e) { errorHandler(res, e); }
};

exports.rateDriver = async (req, res) => {
  try {
    if (req.user.type !== 'passenger') return res.status(403).json({ message: 'Only passengers can rate drivers' });
    const { rating } = req.body;
    const driverId = req.params.driverId;
    const driver = await passengerService.rateDriver(driverId, rating);
    return res.json({ message: 'Driver rated successfully', driver });
  } catch (e) { errorHandler(res, e); }
};

