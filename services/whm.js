const axios = require('axios');
const https = require('https');
const crypto = require('crypto');

const httpsAgent = new https.Agent({ rejectUnauthorized: process.env.NODE_ENV === 'production' });

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

// WHM packages are owned by — and prefixed with — the reseller username.
// On an Asura cPanel RESELLER account this is NOT 'root'; it's your reseller
// username. Set WHM_PACKAGE_PREFIX (or WHM_USER) to that username so the package
// name resolves to one that actually exists on the server.
function packagePrefix() {
  return (process.env.WHM_PACKAGE_PREFIX || process.env.WHM_USER || 'root').trim();
}

function planPackageName(planType, tier) {
  return `${packagePrefix()}_eazworld_${planType}_${tier}`.toLowerCase();
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
async function createAccount({ username, domain, password, email, planType, tier, plan }) {
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
        // Explicit `plan` (full WHM package name) wins; otherwise derive it.
        plan: plan || planPackageName(planType, tier),
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

// ── Shared WHM API v1 caller for the lifecycle/status endpoints ──────────────
// All of these are documented cPanel WHM API v1 functions.
async function callWhm(func, params = {}, timeout = 30000) {
  if (!hasConfig()) return { success: false, error: 'WHM not configured' };
  try {
    const response = await axios.get(`${process.env.WHM_HOST}/json-api/${func}`, {
      params: { 'api.version': 1, ...params },
      headers: { Authorization: authHeader() },
      httpsAgent,
      timeout,
    });
    const meta = response.data?.metadata || {};
    const ok = meta.result === 1 || response.data?.result?.[0]?.status === 1;
    if (ok) return { success: true, data: response.data?.data || {} };
    return {
      success: false,
      error: response.data?.result?.[0]?.statusmsg || meta.reason || `${func} failed`,
    };
  } catch (err) {
    return { success: false, error: err.message || `WHM ${func} request failed` };
  }
}

/** Suspend a cPanel account (WHM `suspendacct`). */
function suspendAccount(username, reason = 'Subscription expired') {
  return callWhm('suspendacct', { user: username, reason });
}

/** Unsuspend a cPanel account (WHM `unsuspendacct`). */
function unsuspendAccount(username) {
  return callWhm('unsuspendacct', { user: username });
}

/** Permanently remove a cPanel account (WHM `removeacct`). Irreversible. */
function terminateAccount(username, keepDns = false) {
  return callWhm('removeacct', { user: username, keepdns: keepDns ? 1 : 0 });
}

/** Change a cPanel account's password (WHM `passwd`). Never log the password. */
function changePassword(username, password) {
  return callWhm('passwd', { user: username, password });
}

/** Live account status/summary (WHM `accountsummary`). */
async function getAccountStatus(username) {
  const res = await callWhm('accountsummary', { user: username }, 10000);
  if (!res.success) return res;
  const acct = res.data?.acct?.[0];
  if (!acct) return { success: false, error: 'Account not found' };
  return {
    success: true,
    suspended: acct.suspended === 1 || acct.suspended === '1',
    domain: acct.domain,
    ip: acct.ip,
    plan: acct.plan,
    diskUsed: acct.diskused,
    diskLimit: acct.disklimit,
    startdate: acct.startdate,
  };
}

/** List WHM packages owned by the reseller (WHM `listpkgs`) — for admin/config validation. */
async function listPackages() {
  const res = await callWhm('listpkgs', {}, 10000);
  if (!res.success) return res;
  const raw = res.data?.pkg || res.data?.package || [];
  const list = Array.isArray(raw) ? raw : [raw];
  return { success: true, packages: list.map((p) => p?.name || p).filter(Boolean) };
}

module.exports = {
  hasConfig,
  createAccount,
  generateUsername,
  generatePassword,
  createSession,
  runAutoSSL,
  planPackageName,
  packagePrefix,
  suspendAccount,
  unsuspendAccount,
  terminateAccount,
  changePassword,
  getAccountStatus,
  listPackages,
};
