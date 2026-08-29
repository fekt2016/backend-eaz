# EazWorld — Project Instructions for Claude

EazWorld is a Ghana-based **digital agency + e-commerce + POS** platform: web-design projects,
domain registration, web hosting, an online shop, an in-store POS (device repair), consultations,
a blog/portfolio, and reviews. Two apps in this monorepo folder, each its own git repository:

| App            | Path            | Stack                                                                 | Repo (GitHub `fekt2016/…`) |
|----------------|-----------------|-----------------------------------------------------------------------|----------------------------|
| **Backend API**| `backend-eaz/`  | Node + Express, **plain JavaScript (CommonJS)**, Mongoose/MongoDB      | `backend-eaz` (branch `main`) |
| **Frontend**   | `frontend-eaz/` | **Next.js 14 App Router**, JS/JSX, **Tailwind CSS** | `frontend-eaz` (branch `main`) |

> The top-level `eazworld/` folder is **not** a git repo — only the two sub-apps are. Run git
> commands inside `backend-eaz/` or `frontend-eaz/`, never at the top level.

## Golden rules

- This is **JavaScript, not TypeScript.** Backend is CommonJS (`require`/`module.exports`); frontend
  is ESM JSX. Do not introduce `.ts`/`.tsx` files or a build step for the backend.
- **Money is stored as integer minor units (pesewas).** GH₵1.00 = 100. Never store floats for money.
  Display with `GH₵` and divide by 100 at the edge only.
- **Payments are Paystack** (card + Mobile Money), Ghana. Verify webhook signatures; fulfil idempotently.
- Preserve the user's uncommitted work. Commit or push only when explicitly asked; branch off `main` first.

## Backend (`backend-eaz/`)

Classic **MVC**, not a layered TS architecture:

```
backend-eaz/
├── server.js            # entry: env + DB connect + listen (has 512MB heap tuning for cPanel)
├── app.js               # Express app: security middleware + route mounting (all under /api/v1)
├── routes/              # thin routers, wire middleware → controller
├── controllers/         # request handling + business logic (async fn (req,res,next) with try/catch → next(err))
├── models/              # Mongoose schemas
├── services/            # external integrations: spaceship, whm, notify, reminderJob
│                        #   (namecheap.js + cyberpanel.js are retired — see T64)
├── middleware/          # auth.js (protect, restrictTo), errorHandler.js
├── validation/          # Zod schemas (authSchema, contactSchema, domainSchema)
├── utils/               # email, invoices, provisioning, jobs, sanitize, validateEnv
└── config/              # cloudinary, hostingPlans
```

Conventions:
- **API base:** everything mounts under `/api/v1/<resource>` in `app.js`.
- **Response envelope:** `{ success: true, data }` on success; errors go through `middleware/errorHandler.js`.
- **Auth:** JWT in an **httpOnly cookie**. Protect routes with `protect`; gate admin with `restrictTo('admin')`.
- **Controllers** are `async (req, res, next)` wrapped in `try/catch` that calls `next(err)`. Use `req.user.id` for identity, never a client-supplied id.
- **Pagination:** clamp `page`/`limit` in the controller (see `productController.getProducts` — default/min/max pattern).
- **Validation:** Zod schemas live in `validation/`. Apply them for new endpoints; some legacy controllers parse manually.
- **Security is already wired in `app.js`:** helmet + CSP, `xss-clean`, `express-mongo-sanitize`, `hpp`, `express-rate-limit`, `cors`, `cookie-parser`. `trust proxy` is 1 (Nginx/cPanel).
- **External domains:** **Spaceship** (domain search/registration — `services/spaceship.js`), WHM on a Spaceship Starlight VPS (hosting provisioning), Cloudinary (uploads), Resend (transactional email — hand-written HTML, no React renderer), Paystack (payments).
- **Domain pricing lives in code.** Spaceship has no pricing endpoint, so per-TLD costs sit in
  `config/domainPricing.js` (USD) and are converted by `usdToGhs()` using `USD_TO_GHS_RATE` +
  `DOMAIN_MARKUP`. Update that file when Spaceship's prices move. Spaceship cannot sell
  `.gh`/`.com.gh`/`.africa` — they're listed in `UNSUPPORTED_TLDS` and rejected before any API call.
- **Spaceship has no sandbox.** Every registration spends real money, so `tests/setup.js` blanks
  `SPACESHIP_API_KEY`/`SPACESHIP_API_SECRET`. Never remove that.
- Run: `cd backend-eaz && npm run dev` (nodemon, port 5000). Health check: `GET /api/health` (note: not versioned).
- Seed shop data: `npm run seed:ecommerce`.

## Frontend (`frontend-eaz/`)

Next.js 14 **App Router**, JavaScript/JSX:

```
frontend-eaz/src/
├── app/                 # routes: shop, commerce, domains, hosting, dashboard (+ pos under dashboard/pos),
│                        #         book-consultation, blog, portfolio, checkout, track-order, …
├── components/          # shared UI (Tailwind)
├── context/             # AuthContext, CartContext, ThemeContext
├── hooks/               # useDebounce, usePortfolio, useBarcodeScanner + queries/ (react-query hooks)
├── lib/                 # api.js (fetch wrapper → { success, data }), queryClient.js/queryKeys.js, cookies.js, shop.js, sanitize.js, printReceipt.js
├── app/globals.css      # Tailwind layers + global focus ring (design tokens in tailwind.config.js)
└── middleware.js        # maintenance-mode gate + JWT verify (jose)
```

Conventions (see root `STYLE_GUIDE.md`):
- **Styling:** **Tailwind CSS** utility classes. `darkMode: "class"`; tokens (`brand` accent scale,
  `font-display`/`font-sans`) in `tailwind.config.js`. Neutrals `gray-*` (light) / `slate-*` (dark); accent `brand-500`; add `dark:` variants on
  public pages. No styled-components, `props.theme.*`, `var(--…)` tokens, or inline styles (except dynamic values).
- **Data fetching:** two patterns coexist. Newer code uses **`@tanstack/react-query`** hooks in
  `hooks/queries/*` (wired via `components/providers/QueryProvider.jsx`); older pages use `useEffect`
  + the **fetch** wrapper in `lib/api.js`. Prefer react-query for new work. (`lib/api.js` is a thin
  `fetch` wrapper, not axios; the `axios` dependency is currently unused — see `REFACTORING_AUDIT.md`.)
- **Currency:** render money with `formatGhs(pesewas)` from `lib/shop.js` (`GH₵1,234.56`) — the single
  formatter. Amounts arrive from the API in pesewas; divide by 100 only at the display edge.
- **API base:** client requests hit the relative `/api/v1` (proxied by Next rewrites in
  `next.config.mjs` to `NEXT_PUBLIC_API_URL`, e.g. `http://localhost:5000/api/v1`).
- Sanitize form input on submit with `lib/sanitize.js`, never on keystroke.
- Run: `cd frontend-eaz && npm run dev` (port 3000).

## Deployment

Backend on cPanel/EC2 via PM2 (`ecosystem.config.js`) behind Nginx (`nginx.conf`); `render.yaml` also present.
Frontend `next build` (`amplify.yml` for AWS Amplify). Backend tuned for a 512MB heap — keep queries lean.

## Working in this repo

- Prefer `lean()` for read-only Mongoose queries; add indexes for new list/filter fields.
- Search for an existing service/util/component before writing a new one — this codebase reuses helpers.
- Match surrounding style: CommonJS + aligned `require` blocks in backend; Tailwind utility classes in frontend.
- Tests: backend has `mongodb-memory-server` available but coverage is sparse; add tests with new logic where practical.

## The `.claude/` fleet

`.claude/agents/`, `.claude/skills/`, and `.claude/commands/` are a specialist-agent scaffold adapted to
this stack. Route real work to the agent whose domain it touches (backend / frontend / database / api /
authentication / payments / integrations / security / testing / performance / devops / documentation).
`.claude/skills/eaz-*` capture the concrete conventions above in depth.
