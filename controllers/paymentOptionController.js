const { PaymentOption, PaymentPreference } = require("../models/indexModel");
const { asyncHandler } = require("../middleware/errorHandler");

exports.list = asyncHandler(async (req, res) => {
  const rows = await PaymentOption.findAll({ order: [["name", "ASC"]] });
  return res.json(rows.map(r => ({ id: r.id, name: r.name, logo: r.logo })));
});

exports.partners = asyncHandler(async (_req, res) => {
  return res.json({
    partners: [
      { id: "telebirr", name: "Telebirr", description: "Telebirr is a mobile money service provider in Ethiopia", input: "phone number", type: "MOBILE_MONEY" },
      { id: "cbebirr", name: "Cbe Birr", description: "CBE Birr is a mobile money service provider in Ethiopia", input: "phone number", type: "MOBILE_MONEY" },
      { id: "mpesa", name: "Mpesa", description: "Mpsea is a mobile money service provider in Ethiopia by Safaricom", input: "phone number", type: "MOBILE_MONEY" },
      { id: "cbe", name: "Commercial Bank of Ethiopia", description: "Commercial Bank of Ethiopia is the largest bank Ethiopia", input: "account number,phone number", type: "BANK" },
      { id: "D‑MONEY", name: "D‑Money", description: "Mobile money in Djibouti", input: "phone number", type: "MOBILE_MONEY" },
      { id: "WAFFI", name: "Waffi", description: "Mobile money in Djibouti", input: "phone number", type: "MOBILE_MONEY" },
      { id: "CAC", name: "CAC", description: "Mobile money in Djibouti", input: "phone number", type: "MOBILE_MONEY" },
    ]
  });
});

exports.create = asyncHandler(async (req, res) => {
  const { name, logo } = req.body || {};
  if (!name || String(name).trim() === '') return res.status(400).json({ message: 'name is required' });
  const exists = await PaymentOption.findOne({ where: { name: String(name).trim() } });
  if (exists) return res.status(409).json({ message: 'Payment option already exists' });
  const row = await PaymentOption.create({ name: String(name).trim(), logo });
  return res.status(201).json({ id: row.id, name: row.name, logo: row.logo });
});

exports.setPreference = asyncHandler(async (req, res) => {
  const userId = String(req.user.id);
  const userType = req.user.type;
  const { payment_option_id, is_active = true } = req.body || {};
  if (!payment_option_id) return res.status(400).json({ message: 'payment_option_id is required' });
  const opt = await PaymentOption.findByPk(payment_option_id);
  if (!opt) return res.status(404).json({ message: 'Payment option not found' });

  const [row, created] = await PaymentPreference.findOrCreate({
    where: { user_id: userId, user_type: userType, payment_option_id },
    defaults: { user_id: userId, user_type: userType, payment_option_id, is_active: !!is_active }
  });
  if (!created) {
    await row.update({ is_active: !!is_active });
  }
  return res.json({ success: true, preference: { payment_option_id, is_active: !!is_active } });
});

exports.getPreference = asyncHandler(async (req, res) => {
  const userId = String(req.user.id);
  const userType = req.user.type;
  const prefs = await PaymentPreference.findAll({ where: { user_id: userId, user_type: userType, is_active: true } });
  return res.json({ preferences: prefs.map(p => ({ payment_option_id: p.payment_option_id, is_active: p.is_active })) });
});

// UPDATE payment option (admin)
exports.update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, logo } = req.body || {};
  const row = await PaymentOption.findByPk(id);
  if (!row) return res.status(404).json({ message: 'Payment option not found' });
  if (name && String(name).trim() !== row.name) {
    const dupe = await PaymentOption.findOne({ where: { name: String(name).trim() } });
    if (dupe) return res.status(409).json({ message: 'Payment option with this name already exists' });
  }
  await row.update({
    name: name != null ? String(name).trim() : row.name,
    logo: logo != null ? logo : row.logo,
  });
  return res.json({ id: row.id, name: row.name, logo: row.logo });
});

// DELETE payment option (admin)
exports.remove = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const row = await PaymentOption.findByPk(id);
  if (!row) return res.status(404).json({ message: 'Payment option not found' });
  await row.destroy();
  return res.json({ success: true, id });
});

