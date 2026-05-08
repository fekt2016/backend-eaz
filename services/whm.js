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
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%^&*';
  const all = upper + lower + digits + special;
  const rand = (set) => set[Math.floor(Math.random() * set.length)];
  const base = Array.from({ length: 12 }, () => rand(all)).join('');
  return rand(upper) + rand(lower) + rand(digits) + rand(special) + base;
}

function planPackageName(planType, tier) {
  return `root_eazworld_${planType}_${tier}`.toLowerCase();
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

/**
 * Trigger AutoSSL for a specific cPanel user immediately after account creation.
 * WHM AutoSSL must be configured with Let's Encrypt (or Sectigo) as the provider.
 * This runs the SSL check/install for the user's domain without waiting for the nightly cron.
 *
 * @param {string} username - cPanel username
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function runAutoSSL(username) {
  if (!hasConfig()) {
    return { success: false, error: 'WHM not configured' };
  }

  try {
    const response = await axios.get(`${process.env.WHM_HOST}/json-api/start_autossl_check_for_one_user`, {
      params: {
        'api.version': 1,
        username,
      },
      headers: { Authorization: authHeader() },
      httpsAgent,
      timeout: 30000,
    });

    const data = response.data?.metadata || response.data;
    if (data?.result === 1 || response.data?.result?.[0]?.status === 1 || data?.status === 1) {
      console.log(`[WHM] AutoSSL triggered for ${username}`);
      return { success: true };
    }

    const reason = response.data?.result?.[0]?.statusmsg || data?.reason || 'AutoSSL trigger failed';
    console.warn(`[WHM] AutoSSL trigger warning for ${username}: ${reason}`);
    // Non-fatal — AutoSSL will still run on the nightly cron
    return { success: false, error: reason };
  } catch (err) {
    console.warn(`[WHM] AutoSSL trigger failed for ${username}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Create a temporary login session for a cPanel user.
 * @param {string} username - cPanel username
 * @returns {Promise<{ success: boolean, url?: string, error?: string }>}
 */
async function createSession(username) {
  if (!hasConfig()) {
    return { success: false, error: 'WHM not configured' };
  }

  try {
    const response = await axios.get(`${process.env.WHM_HOST}/json-api/create_user_session`, {
      params: {
        'api.version': 1,
        user: username,
        service: 'cpaneld',
      },
      headers: { Authorization: authHeader() },
      httpsAgent,
      timeout: 10000,
    });

    const data = response.data?.data || {};
    if (data.url) {
      return { success: true, url: data.url };
    }

    return { success: false, error: response.data?.metadata?.reason || 'Failed to create cPanel session' };
  } catch (err) {
    return { success: false, error: err.message || 'WHM session request failed' };
  }
}

module.exports = { hasConfig, createAccount, generateUsername, generatePassword, createSession, runAutoSSL };
