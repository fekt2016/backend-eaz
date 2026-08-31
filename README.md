# backend-eaz

Express + MongoDB API for EazWorld. All routes mount under `/api/v1`.

```bash
npm install
cp .env.example .env    # then fill it in
npm run dev             # nodemon, port 5000
```

Health check: `GET /api/health`.

## Deployment

Runs on **Spaceship Essential** (shared cPanel, LiteSpeed, AutoSSL) under Phusion
Passenger, deployed by `.cpanel.yml` through cPanel Git Version Control. No Nginx,
no PM2 — a restart is `touch tmp/restart.txt`.

See **[docs/HOSTING.md](docs/HOSTING.md)** for DNS, cPanel app setup, the 5-hostname
budget, and the limits of this plan.
