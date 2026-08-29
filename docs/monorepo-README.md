# EazWorld

Ghana-based digital-agency platform: web-design projects, domain registration, web hosting, an online shop,
an in-store POS, consultations, a blog, and a portfolio. Built with Next.js 14 (frontend) and Express (backend).

This top-level folder holds two independent git repositories:

| App             | Directory       | Repo (`github.com/fekt2016/…`) |
|-----------------|-----------------|--------------------------------|
| Backend API     | `backend-eaz/`  | `backend-eaz` (branch `main`)  |
| Frontend        | `frontend-eaz/` | `frontend-eaz` (branch `main`) |

> The `eazworld/` folder itself is **not** a git repo — run git commands inside `backend-eaz/` or `frontend-eaz/`.

## Stack

- **Frontend**: Next.js 14 (App Router), **JavaScript/JSX**, styled-components (CSS-variable design system) + Tailwind CSS, Framer Motion, TanStack Query, Axios, `jose`
- **Backend**: Node.js, Express, **plain JavaScript (CommonJS)**, Mongoose (MongoDB)
- **Domain API**: Namecheap
- **Hosting provisioning**: WHM / CyberPanel (cPanel)
- **Payments**: Paystack (card + Mobile Money, GH₵)
- **Media**: Cloudinary · **Email**: Resend + react-email
- **Auth**: JWT in an httpOnly cookie

> Money is stored and transported as **integer pesewas** (GH₵1.00 = 100); format `GH₵` only at the UI edge.

## Local setup

### Prerequisites

- Node.js 18+
- MongoDB (local or Atlas)
- npm

### Backend

```bash
cd backend-eaz
cp .env.example .env
# Edit .env with MONGO_URL, JWT_SECRET, PAYSTACK_SECRET, etc.
npm install
npm run dev
```

API runs at `http://localhost:5000`. Health check: `GET /api/health`. Seed shop data: `npm run seed:ecommerce`.

### Frontend

```bash
cd frontend-eaz
cp .env.local.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1 (and JWT_SECRET to match the backend)
npm install
npm run dev
```

App runs at `http://localhost:3000`.

## Environment variables

### Backend (`backend-eaz/.env`)

| Variable | Description |
|----------|-------------|
| PORT | Server port (default 5000) |
| NODE_ENV | development / production |
| MONGO_URL, DATABASE_PASSWORD | MongoDB connection |
| JWT_SECRET, JWT_EXPIRES_IN | Auth |
| EMAIL_USER, EMAIL_PASS / RESEND_API_KEY | Transactional email (password reset, order/hosting mail) |
| CLIENT_URL, FRONTEND_URL | Allowed origins and reset-link base |
| NAMECHEAP_API_USER, NAMECHEAP_API_KEY, NAMECHEAP_CLIENT_IP, NAMECHEAP_SANDBOX | Namecheap API |
| PAYSTACK_SECRET | Paystack secret key |
| CLOUDINARY_* | Image uploads |
| WHM_*, CYBERPANEL_* | Hosting provisioning |

See `backend-eaz/.env.example` for the full list.

### Frontend (`frontend-eaz/.env.local`)

| Variable | Description |
|----------|-------------|
| NEXT_PUBLIC_API_URL | Backend API base URL (e.g. `http://localhost:5000/api/v1`) |
| JWT_SECRET | Must match the backend — the Next.js middleware verifies auth tokens with it (server-only, no `NEXT_PUBLIC_` prefix) |
| NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY | Paystack public key for inline checkout (optional) |

See `frontend-eaz/.env.local.example` for the full list.

## API overview

All endpoints are mounted under `/api/v1`. Success responses use the envelope `{ "success": true, "data": … }`.
Resource groups (see `backend-eaz/routes/`):

| Group | Base path | Notes |
|-------|-----------|-------|
| Auth | `/api/v1/auth` | register, login, logout, me, forgot/reset password |
| Domains | `/api/v1/domain` | search/suggestions, Paystack payment, webhook, orders (admin) |
| Hosting | `/api/v1/hosting` | plans, orders, provisioning |
| Products | `/api/v1/products` | shop catalog (public reads, admin CRUD) |
| Orders | `/api/v1/orders` | shop checkout & orders |
| Delivery zones | `/api/v1/delivery-zones` | shipping fees |
| POS | `/api/v1/pos` | repair jobs, customers, parts, payments, sales |
| Contacts | `/api/v1/contacts` | contact form (submit) + admin list |
| Projects | `/api/v1/projects` | portfolio |
| Posts | `/api/v1/posts` | blog |
| Reviews | `/api/v1/reviews` | customer reviews |
| Services | `/api/v1/services` | service orders / consultations |
| Chat | `/api/v1/chat` | consultation chat sessions |
| Settings | `/api/v1/settings` | site settings incl. maintenance mode |
| Track | `/api/v1/track` | order/shipment tracking |
| Uploads | `/api/v1/uploads` | Cloudinary image upload (admin) |
| Admin | `/api/v1/admin` | admin utilities |

Example endpoints:

- `POST /api/v1/auth/register` – Register
- `POST /api/v1/auth/login` – Login
- `GET /api/v1/auth/me` – Current user (protected)
- `PATCH /api/v1/auth/reset-password/:token` – Reset password
- `GET /api/v1/domain/search?domain=` – Domain availability + suggestions
- `POST /api/v1/domain/webhook` – Paystack webhook
- `GET /api/v1/products` – List shop products
- `POST /api/v1/uploads` – Upload image (admin)

## Deployment

The backend runs on cPanel/EC2 under PM2 behind Nginx, tuned for a ~512MB heap (see the memory handling in
`backend-eaz/server.js`). The frontend builds with `next build` (AWS Amplify config in `frontend-eaz/amplify.yml`;
a `render.yaml` is also present for the backend).

1. Clone both repos and install dependencies (`backend-eaz` + `frontend-eaz`).
2. Set production env vars (`backend-eaz/.env`, `frontend-eaz/.env.local` or env in PM2/Amplify).
3. Build the frontend: `cd frontend-eaz && npm run build`.
4. Start the backend with PM2: `pm2 start ecosystem.config.js --env production`.
5. Configure Nginx using `nginx.conf` (update `server_name` and SSL paths).
6. For updates: pull, `npm install`, rebuild the frontend, and `pm2 restart` the backend.

## License

Proprietary.
