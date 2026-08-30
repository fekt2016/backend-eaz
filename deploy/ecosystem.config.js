// EazWorld — PM2 process definitions.
//
// T85: NODE_ENV used to live ONLY in `env_production`, which PM2 applies only
// when started with `--env production`. Started any other way — the obvious
// `pm2 start ecosystem.config.js`, or a restart from a saved process list —
// NODE_ENV was unset, and two security controls switched off silently and
// together:
//   • the auth cookie lost `Secure` and dropped sameSite from strict to lax
//     (controllers/authController.js:41-42, both keyed on NODE_ENV)
//   • the error handler began returning err.stack to clients on every error
//     (middleware/errorHandler.js)
// Neither logs anything. So `env` now carries production too: this file is only
// ever used to run the deployed app, and the safe default for it is production.
// `--env production` still works and is still the documented command.
//
// T122: this file used to sit at the monorepo root, which is NOT a git repo, so
// the deployment configuration was unversioned and unreviewable. It now lives in
// backend-eaz/deploy/ and is tracked.
//
// Paths are resolved from __dirname rather than written relative to the caller's
// working directory, so `pm2 start` works from anywhere. ROOT is the monorepo
// root — two levels up from backend-eaz/deploy/ — because this config runs BOTH
// apps and the frontend lives beside the backend, not inside it.
//
// Start:    pm2 start backend-eaz/deploy/ecosystem.config.js --env production
// Reload:   pm2 reload backend-eaz/deploy/ecosystem.config.js --env production
// Verify:   pm2 env 0 | grep NODE_ENV      → must print production
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

module.exports = {
  apps: [
    {
      name: "eazworld-api",
      script: path.join(ROOT, "backend-eaz", "server.js"),
      // cwd MUST be backend-eaz, not the monorepo root. server.js:7 and
      // app.js:14 both call dotenv.config({ path: "./.env" }) — resolved
      // against process.cwd(), not __dirname — and the only .env is
      // backend-eaz/.env. Measured: from the monorepo root dotenv returns
      // ENOENT and loads 0 variables; from backend-eaz it loads 45. The old
      // config said cwd: "./" (the root), so it started the API in a directory
      // where its own .env is invisible, leaving MONGO_URL/JWT_SECRET/
      // PAYSTACK_SECRET unset and validateEnv exiting 1.
      cwd: path.join(ROOT, "backend-eaz"),
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      // Default env — deliberately production. See the note above.
      env: {
        NODE_ENV: "production",
        PORT: 5000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,
      },
    },
    {
      name: "eazworld-frontend",
      script: "npm",
      args: "start",
      cwd: path.join(ROOT, "frontend-eaz"),
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
