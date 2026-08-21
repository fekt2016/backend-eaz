const js = require('@eslint/js');
const n = require('eslint-plugin-n');
const globals = require('globals');

// Plain CommonJS Node backend — no TS, no build step (see CLAUDE.md).
module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  n.configs['flat/recommended-script'],
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Route handlers/middleware intentionally ignore some callback args
      // (e.g. `(err, req, res, next)` error handlers, unused `req` in some
      // routes) — warn instead of error, and allow a leading-underscore escape.
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      // scripts/*.js's `main().catch(...)` handlers do a best-effort
      // `try { await mongoose.disconnect(); } catch (_) {}` before exiting —
      // deliberately swallowed, so a failed disconnect can't mask the real error.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // This project deliberately hasn't run `npm audit fix` / dependency
      // bumps yet (see T11) — don't fail lint on version-pinning style.
      'n/no-unpublished-require': 'off',
      'n/no-missing-require': 'error',
      'n/no-extraneous-require': 'error',
      // Idiomatic here: server.js's fatal-startup-error handler, utils/validateEnv.js's
      // config validation, and the one-off scripts/ and src/migrate*.js CLI tools all
      // deliberately process.exit() on unrecoverable conditions instead of throwing
      // (there's no caller above them to catch a throw meaningfully).
      'n/no-process-exit': 'off',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
];
