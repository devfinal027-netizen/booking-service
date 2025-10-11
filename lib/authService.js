const axios = require('axios');

const authClient = axios.create({
  baseURL: process.env.AUTH_BASE_URL,
  timeout: 10000,
});

async function getPassengerById(id) {
  const tpl = process.env.PASSENGER_LOOKUP_URL_TEMPLATE || `${process.env.AUTH_BASE_URL}/passengers/{id}`;
  const url = tpl.replace('{id}', String(id));
  const { data } = await authClient.get(url);
  return data;
}

async function getDriverById(id) {
  const tpl = process.env.DRIVER_LOOKUP_URL_TEMPLATE || `${process.env.AUTH_BASE_URL}/drivers/{id}`;
  const url = tpl.replace('{id}', String(id));
  const { data } = await authClient.get(url);
  return data;
}

module.exports = { getPassengerById, getDriverById };
