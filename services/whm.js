const axios = require('axios');
const https = require('https');
const crypto = require('crypto');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function hasConfig() {
  return !!(process.env.WHM_HOST && process.env.WHM_TOKEN);
}

function authHeader() {
  const user = process.env.WHM_USER || 'root';
  return `whm ${user}:${process.env.WHM_TOKEN}`;
}

function generateUsername(email) {
  const base = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
  const suffix = crypto.randomBytes(2).toString('hex');
  return (base.slice(0, 5) + suffix).slice(0, 8);
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function planPackageName(planType, tier) {
  return `eazworld_${planType}_${tier}`.toLowerCase();
}

/**
 * Create a cPanel account via WHM API.
 * @param {object} opts
 * @param {string} opts.username  - cPanel username (max 8 chars, alphanumeric)
 * @param {string} opts.domain    - Primary domain for the account
 * @param {string} opts.password  - cPanel password
 * @param {string} opts.email     - Contact email
 * @param {string} opts.planType  - e.g. 'shared'
 * @param {string} opts.tier      - e.g. 'deluxe'
 * @returns {Promise<{ success: boolean, username?: string, password?: string, error?: string }>}
 */
async function createAccount({ username, domain, password, email, planType, tier }) {
  if (!hasConfig()) {
    return { success: false, error: 'WHM not configured' };
  }

  try {
    const response = await axios.get(`${process.env.WHM_HOST}/json-api/createacct`, {
      params: {
        'api.version': 1,
        username,
        domain,
        password,
        contactemail: email,
        plan: planPackageName(planType, tier),
        reseller: 0,
      },
      headers: { Authorization: authHeader() },
      httpsAgent,
      timeout: 30000,
    });

    const data = response.data?.metadata || response.data;

    if (data?.result === 1 || response.data?.result?.[0]?.status === 1) {
      return { success: true, username, password };
    }

    const reason =
      response.data?.result?.[0]?.statusmsg ||
      data?.reason ||
      'Account creation failed';

    return { success: false, error: reason };
  } catch (err) {
    return { success: false, error: err.message || 'WHM API request failed' };
  }
}

module.exports = { hasConfig, createAccount, generateUsername, generatePassword };
