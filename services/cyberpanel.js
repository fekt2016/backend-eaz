const axios = require("axios");
const https = require("https");
const crypto = require("crypto");

const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === "production",
});

function hasConfig() {
  return !!(process.env.CYBERPANEL_HOST && process.env.CYBERPANEL_PASS);
}

function generateUsername(email) {
  const base = email
    .split("@")[0]
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  const suffix = crypto.randomBytes(2).toString("hex");
  return (base.slice(0, 5) + suffix).slice(0, 8);
}

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  return Array.from(
    { length: 16 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}
// this gets package name

function getPackageName(planType, tier) {
  const map = {
    "shared-starter": "Starter",
    "shared-deluxe": "Deluxe",
    "shared-premium": "Premium",
    "wordpress-starter": "Starter",
    "wordpress-deluxe": "Deluxe",
    "wordpress-premium": "Premium",
  };
  return map[`${planType}-${tier}`.toLowerCase()] || "Default";
}

/**
 * Create a hosting account via CyberPanel API
 */
async function createAccount({ email, domain, planType, tier }) {
  if (!hasConfig()) {
    return { success: false, error: "CyberPanel not configured" };
  }

  const username = generateUsername(email);
  const password = generatePassword();
  const accountDomain = domain || `${username}.eazworld.com`;
  const packageName = getPackageName(planType, tier);

  try {
    const response = await axios.post(
      `${process.env.CYBERPANEL_HOST}/api/createWebsite`,
      {
        adminUser: process.env.CYBERPANEL_USER || "admin",
        adminPass: process.env.CYBERPANEL_PASS,
        domainName: accountDomain,
        ownerEmail: email,
        websiteOwner: username,
        ownerPassword: password,
        packageName,
        writablePaths: "0",
      },
      {
        httpsAgent,
        timeout: 30000,
        headers: { "Content-Type": "application/json" },
      },
    );

    const data = response.data;

    if (data?.status === 1) {
      return { success: true, username, password, domain: accountDomain };
    }

    return {
      success: false,
      error:
        data?.error_message ||
        data?.errorMessage ||
        "CyberPanel account creation failed",
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || "CyberPanel API request failed",
    };
  }
}

module.exports = {
  hasConfig,
  createAccount,
  generateUsername,
  generatePassword,
};
