const crypto = require("crypto");
const axios = require("axios");
const fs = require("fs");

function cleanEnvString(value) {
  if (value == null) return null;
  let v = String(value);
  // trim whitespace
  v = v.trim();
  // strip surrounding quotes
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  // replace literal \n with newline
  v = v.replace(/\\n/g, "\n");
  return v;
}

const BASE_URL = cleanEnvString(process.env.SANTIMPAY_BASE_URL) || "https://gateway.santimpay.com/api";
const GATEWAY_MERCHANT_ID = cleanEnvString(process.env.GATEWAY_MERCHANT_ID);

function resolvePrivateKeyPem() {
  // Priority: explicit PEM -> BASE64 -> PATH
  const pemDirect = cleanEnvString(process.env.PRIVATE_KEY_IN_PEM);
  if (pemDirect && pemDirect.length > 0) {
    return pemDirect;
  }
  const b64 = cleanEnvString(process.env.PRIVATE_KEY_BASE64);
  if (b64 && b64.length > 0) {
    try {
      return Buffer.from(b64, "base64").toString("utf8");
    } catch (_) {}
  }
  const path = cleanEnvString(process.env.PRIVATE_KEY_PATH);
  if (path && path.length > 0) {
    try {
      return fs.readFileSync(path, "utf8");
    } catch (_) {}
  }
  return null;
}

function importPrivateKey(pem) {
  const effectivePem = pem || resolvePrivateKeyPem();
  if (!effectivePem || !String(effectivePem).trim()) {
    throw new Error("SantimPay config error: missing PRIVATE_KEY (set PRIVATE_KEY_IN_PEM, or PRIVATE_KEY_BASE64, or PRIVATE_KEY_PATH)");
  }
  return crypto.createPrivateKey({ key: effectivePem, format: "pem" });
}

function signES256(payload, privateKeyPem) {
  const header = { alg: "ES256", typ: "JWT" };
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const sign = crypto.createSign("SHA256");
  sign.update(unsigned);
  sign.end();
  const key = importPrivateKey(privateKeyPem);
  const signature = sign.sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${unsigned}.${signature}`;
}

function ensureMerchant() {
  if (!GATEWAY_MERCHANT_ID || !String(GATEWAY_MERCHANT_ID).trim()) {
    throw new Error("SantimPay config error: missing GATEWAY_MERCHANT_ID env");
  }
}

function tokenForInitiatePayment(amount, paymentReason) {
  ensureMerchant();
  const time = Math.floor(Date.now() / 1000);
  const payload = { amount, paymentReason, merchantId: GATEWAY_MERCHANT_ID, generated: time };
  return signES256(payload);
}

function tokenForDirectPayment(amount, paymentReason, paymentMethod, phoneNumber) {
  ensureMerchant();
  const time = Math.floor(Date.now() / 1000);
  const payload = { amount, paymentReason, paymentMethod, phoneNumber, merchantId: GATEWAY_MERCHANT_ID, generated: time };
  return signES256(payload);
}

function tokenForGetTransaction(id) {
  ensureMerchant();
  const time = Math.floor(Date.now() / 1000);
  const payload = { id, merId: GATEWAY_MERCHANT_ID, generated: time };
  return signES256(payload);
}

async function initiatePayment({ id, amount, paymentReason, successRedirectUrl, failureRedirectUrl, notifyUrl, phoneNumber = "", cancelRedirectUrl = "" }) {
  const token = tokenForInitiatePayment(amount, paymentReason);
  const payload = { id, amount, reason: paymentReason, merchantId: GATEWAY_MERCHANT_ID, signedToken: token, successRedirectUrl, failureRedirectUrl, notifyUrl, cancelRedirectUrl };
  if (phoneNumber) payload.phoneNumber = phoneNumber;
  const res = await axios.post(`${BASE_URL}/initiate-payment`, payload, { headers: { "Content-Type": "application/json" } });
  return res.data;
}

async function directPayment({ id, amount, paymentReason, notifyUrl, phoneNumber, paymentMethod }) {
  const token = tokenForDirectPayment(amount, paymentReason, paymentMethod, phoneNumber);
  const payload = { id, amount, reason: paymentReason, merchantId: GATEWAY_MERCHANT_ID, signedToken: token, phoneNumber, paymentMethod, notifyUrl };
  const res = await axios.post(`${BASE_URL}/direct-payment`, payload, { headers: { "Content-Type": "application/json" } });
  return res.data;
}

async function payoutTransfer({ id, amount, paymentReason, phoneNumber, paymentMethod, notifyUrl }) {
  const token = tokenForDirectPayment(amount, paymentReason, paymentMethod, phoneNumber);
  const payload = { id, clientReference: id, amount, reason: paymentReason, merchantId: GATEWAY_MERCHANT_ID, signedToken: token, receiverAccountNumber: phoneNumber, notifyUrl, paymentMethod };
  const res = await axios.post(`${BASE_URL}/payout-transfer`, payload, { headers: { "Content-Type": "application/json" } });
  return res.data;
}

async function checkTransactionStatus(id) {
  const token = tokenForGetTransaction(id);
  const payload = { id, merchantId: GATEWAY_MERCHANT_ID, signedToken: token };
  const res = await axios.post(`${BASE_URL}/fetch-transaction-status`, payload, { headers: { "Content-Type": "application/json" } });
  return res.data;
}

module.exports = {
  signES256,
  initiatePayment,
  directPayment,
  payoutTransfer,
  checkTransactionStatus,
};

