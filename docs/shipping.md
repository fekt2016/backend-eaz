# Shipping System (T78 + T80 E2)

Single-vendor fulfilment and delivery-fee system for Ghana e-commerce orders.
Every price is server-computed — the client never influences a stored value.
Money is integer pesewas end-to-end (`GH₵1.00 === 100`).

T78 shipped delivery inside Greater Accra. **T80 E2** added nationwide reach:
regions, `bus_station_pickup` for addresses outside the Greater-Accra core, a
distance-based fee formula, and same-day cutoff rules.

## Architecture

```
POST /shipping/quote          ← public, rate-limited
        │  loads Products from the DB (weight/category/fragility)
        │  the body supplies only productIds + quantities
        ▼
  shippingCalculator.js       ← the ONLY place a fee is computed
        │  reads ShippingZone + ShippingTier + ShippingSettings + Location
        │  from an in-process cache (300 s TTL)
        ▼
  ShippingQuote (15 min TTL)   ← persisted with cartHash (SHA-256)
        │
        ▼
POST /orders                  ← consumes quote, rechecks hash, creates Order
        │
        ▼
  Order.shippingFee           ← source of truth; deliveryFee synced by pre-save hook
        │
        ▼ (on status → delivered)
  settleDeliveryCharge()      ← reads CourierRate → creates DeliveryCharge
        │
        ▼
  DeliveryCharge              ← courierPayout + retainedMargin === shippingFeeCollected
```

## Fulfilment gate (T80 E2)

Before any pricing, the calculator resolves the customer's region against
`Location.inAccraCore` and enforces the split. This is server-side and
absolute — a client cannot smuggle a fulfilment mode either way:

| Where | Allowed methods | Rejected with |
|---|---|---|
| Inside the Greater-Accra core | `in_house_delivery`, `courier_dispatch` | pickup → `InvalidFulfilmentMethodError` |
| Outside the core | `bus_station_pickup` (tied to an active `PickupLocation`) | delivery → `InvalidFulfilmentMethodError` |

When the caller sends no `region`, the legacy closed `Accra`/`Tema` city enum is
used instead, so pre-E2 callers and tests keep working.

Fail-fast gates that run *before* any zone/tier maths:

- per-method availability flags (`inHouseDeliveryAvailable`,
  `courierDispatchAvailable`, `pickupAvailable`) and `expressAvailable`
- **same-day cutoff** — rejected at/after `settings.sameDayCutoffHour`
  (default 12:00 PM) and on closed days (`settings.deliveryClosedDays`,
  default Sunday). Bus-station pickup is exempt from both.
- **in-house radius** — a zone whose `distanceMaxKm` exceeds
  `settings.inHouseRadiusKm` is pushed to courier (`OutOfRangeError`).

## The three fee formulas

The branch is chosen by the fulfilment mode and by what the zone has
configured. All arithmetic is in integer pesewas, rounded half-up at each step.

### 1. Regional pickup — when `method === "bus_station_pickup"`

```
fee = round(regionalBaseFee + totalWeightKg × regionalPricePerKg)
fee += zone.fragileSurcharge          // once per order, if any item is fragile
```

Falls back to `distanceBaseFee`/`baseRate` and `pricePerKg`/`perKgRate` when the
regional fields are unset, so an unconfigured pickup zone never yields an
accidental zero. `tierLevel` is 0 and `estimatedDays` is null for pickup.

### 2. E2 distance formula — when the zone sets any of `distanceBaseFee` / `pricePerKm` / `pricePerKg`

```
fee = round(distanceBaseFee + distanceKm × pricePerKm + totalWeightKg × pricePerKg)
fee += zone.fragileSurcharge
```

`distanceKm` comes from one of two sources, and the quote reports which in
`distanceSource`:

| `distanceSource` | Where `distanceKm` comes from |
|---|---|
| `google` | The neighbourhood's measured driving distance from the shop origin, resolved by an admin and cached in `NeighborhoodDistance`. |
| `zone_band` | `midpoint(zone.distanceMinKm, zone.distanceMaxKm)`, or 0 when the band is absent. |

See **Google-Maps distance pricing** below. The band is always the fallback, so
a half-populated distance table still quotes every address.

### 3. Legacy T78 formula — every other delivery zone

```
fee = round(zone.baseRate × tier.multiplier)
fee = round(fee × speedMultiplier)                  // same_day / express / 1.0
billableKg = max(0, totalWeightKg − tier.weightThresholdKg)   // exactly at the threshold bills nothing
fee = round(fee + billableKg × (tier.weightSurchargePerKg || zone.perKgRate))
fee += anyItemFragile ? tier.fragileSurcharge + zone.fragileSurcharge : 0
```

For `courier_dispatch`, `courierBaseRate` / `courierPerKgRate` replace
`baseRate` / `perKgRate` when set.

### Free delivery

Free delivery is a property of **who delivers**, not of basket size:

```
in_house_delivery              → always free (our own rider, nothing to recover)
courier_dispatch               → NEVER free (a third party is paid per drop)
bus_station_pickup             → never free (a service fee, not a delivery charge)
```

This is structural, not a setting. `freeDeliveryThreshold` no longer affects
any method and is now **inert** — it is left on the model so a future
promotion has somewhere to live, but nothing reads it. Reinstating "free
courier over GH₵X" means changing `shippingCalculator` and the methods
endpoint together, not flipping a flag.

`grossShippingFee` always carries the real cost, so an in-house order still
shows what the delivery would otherwise have cost. The gross fee is
always returned alongside as `grossShippingFee`, so the storefront can show
"FREE (was GH₵25.00)".

### Unknown weights

`Product.weight` of 0, negative, or non-numeric means "unknown". Such a line is
priced at **0.5 kg** (`ASSUMED_WEIGHT_KG`) and the quote comes back with
`weightAssumed: true`, so support can explain the charge and the catalogue can
be fixed. Units are converted from `g` / `lb` / `kg`.

### Zone and tier resolution

- **Zone** — exact neighbourhood match first (neighbourhoods are lowercased in
  the DB), else the city's `isDefault` zone, else lowest `distanceMinKm` then
  name ascending. Nothing active in the region/city ⇒
  `UnsupportedDeliveryAreaError`. Never a silent zero fee.
- **Tier** — the highest `level` across all items wins (one screen plus twenty
  cables prices at the screen tier); ties break on the higher multiplier.
  Unmapped categories contribute no candidate and are not an error; a cart of
  entirely unmapped categories falls to the editable `__default__` row, then to
  the frozen `DEFAULT_TIER` constant in `models/ShippingTier.js`.

### Courier payout (on delivery)

```
CourierRate.mode = "percentage":  payout = round(fee × percentage / 100)
CourierRate.mode = "flat":        payout = flatAmount
CourierRate.mode = "per_zone":    payout = zoneRates[zoneCode].amount

fallback: payout = round(fee × 30 / 100)    // never stiff the courier

retainedMargin = fee − courierPayout          // may be negative (surfaced, not clamped)
```

## Google-Maps distance pricing

Real driving distance instead of a hand-drawn distance band. Two admin knobs in
**Business Settings → Shipping**:

- **Origin address** (`settings.originAddress`) — free text, the address every
  distance is measured *from* (the Nima warehouse). Google geocodes it.
- **Price by measured distance** (`settings.useGoogleDistance`) — the master
  switch. Off by default.

### Google is never called during checkout

This is the load-bearing design decision. Distances between a fixed warehouse
and a fixed neighbourhood do not change, Google bills per element, and a
third-party timeout on the quote path would take checkout down. So:

```
ADMIN (rare, deliberate)              CHECKOUT (hot path)
────────────────────────              ───────────────────
POST /admin/shipping/distances/resolve      POST /shipping/quote
        │                                           │
        ▼                                           ▼
  googleDistance.js  ──► Google API           shippingCalculator
        │                                     resolveDistanceKm()
        ▼                                           │
  NeighborhoodDistance  ◄───────────────── reads only this ─┘
```

`services/shipping/googleDistance.js` is the ONLY module that talks to Google,
and nothing on the quote path requires it.

### Which Google API

`googleDistance.js` tries the **Routes API** (`computeRouteMatrix`) first, then
falls back to the legacy **Distance Matrix API** on a 403/404. Google closed the
legacy API to new customers on 1 March 2025, so a key from a recent Cloud
project only works via Routes, while an older project's key still works either
way. The fallback fires only on those two status codes — a quota or network
error is not retried against a second paid endpoint.

Enable **Routes API** on the Cloud project for `GOOGLE_MAPS_API_KEY`.

> **Billing must be enabled on the Cloud project**, even though Maps Platform
> includes a monthly free-credit allowance. Without it every call returns 403
> `BILLING_DISABLED` — on both the Routes and the legacy endpoint. The service
> detects this case specifically, skips the pointless legacy retry, and returns
> "Google Maps billing is not enabled for this project", which the admin UI
> shows verbatim. This is the most common setup failure.

### Resolution is incremental

`POST /distances/resolve` skips any neighbourhood already measured from the
*current* origin, and never overwrites a `manual` override. Adding two
neighbourhoods and re-running bills for two lookups, not the whole city.
`{ force: true }` re-measures everything, overrides included.

Changing `originAddress` changes the `originKey` hash, which marks every stored
row **stale** in the admin list. Stale rows keep pricing (a distance from the
old warehouse beats no distance at all) until deliberately re-measured.

### When Google cannot route

Informal settlements and new developments often fail to geocode. Those come
back `NOT_FOUND` and stay unmeasured; the admin types a number via
`PATCH /distances` and it is stored with `source: "manual"`.

### Cost shape

One element per neighbourhood, once. A 40-neighbourhood city is 40 elements
total, then zero until neighbourhoods are added or the origin moves.

## Distance zones (A–F)

Six distance-banded zones price Greater-Accra core deliveries. Every
serviceable neighbourhood is pre-assigned to one, so **checkout resolves a zone
with a single indexed read and never geocodes anything**.

### Rate table

| Zone | Band (km) | Base | Per kg | Fragile | ETA |
|---|---|---|---|---|---|
| A | 0 – 5 | GH₵15.00 | GH₵2.00 | +GH₵5.00 | 1–2 days |
| B | 5 – 10 | GH₵30.00 | GH₵2.50 | +GH₵5.00 | 1–2 days |
| C | 10 – 15 | GH₵40.00 | GH₵3.00 | +GH₵5.00 | 1–2 days |
| D | 15 – 25 | GH₵50.00 | GH₵3.50 | +GH₵5.00 | 2–3 days |
| E | 25 – 40 | GH₵65.00 | GH₵4.00 | +GH₵5.00 | 2–3 days |
| F | 40 – 100 | GH₵80.00 | GH₵5.00 | +GH₵5.00 | 2–3 days |

Stored in pesewas (GH₵15.00 === 1500). Beyond 100 km is **outside the service
area** — an error, never a silent fall-through to Zone F.

Bands are **half-open `[minKm, maxKm)`** and contiguous. Ranges written as
`0–5`, `5.01–10` and matched with `min ≤ d ≤ max` leave a hole at 5.005 km that
belongs to no zone and throws at checkout; half-open bounds tile the line with
no gap and no overlap. `checkCoverage()` asserts this, and `server.js` runs it
at boot so a bad admin edit surfaces on deploy rather than on an order.

### Speed tiers

`ShippingZone.speedTiers` is a subdocument array keyed by `code`, not one
schema field per speed:

| Code | Label | Multiplier |
|---|---|---|
| `standard` | Standard | ×1.0 |
| `next_day` | Next Day | ×1.2 |
| `express` | Express | ×1.5 |
| `same_day` | Same Day | ×1.2 |

Named per-speed fields invite exactly one bug — a call site reading
`expressMultiplier` for same-day orders while the admin panel labels each field
by its schema name, so editing "same-day" silently reprices express. Keying on
`code` makes that unrepresentable, and a new tier needs no schema change.
`same_day` additionally carries the 12 PM cutoff and closed-day rules.

### The formula

```
chargeableWeight = max(weightKg, 0.5)                  // never bill below 0.5 kg
subtotal         = baseRate + perKgRate × chargeableWeight
afterSpeed       = subtotal × speedMultiplier
fee              = ceilToCedi(afterSpeed + (fragile ? fragileSurcharge : 0))
```

The fragile surcharge lands **after** the multiplier, so an express fragile
order does not pay 1.5× the surcharge too. `calcShippingWithBreakdown()`
returns the line-by-line derivation the checkout UI renders; its components sum
to the fee exactly (`roundingAdjustment` carries the ceil).

A speed code the zone does not define **throws** — it is not ×1.0. Defaulting
an unknown speed to the cheapest multiplier is a silent under-charge: nothing
errors, nobody complains, the margin just leaks.

### Prices shown before the quote

`GET /shipping/methods` prices through the **same** calculator `/shipping/quote`
uses, given `neighborhoodId` (or a neighbourhood name) plus the cart's
`subtotal` and `weightKg`. That matters because the storefront shows those
figures before it asks for a quote: when the two disagreed, the price visibly
changed under the customer a second after they picked a method.

It also returns the tiers **the zone itself defines** rather than a hardcoded
list, so what is offered is always what can be priced, and it withholds
`same_day` once the cutoff has passed rather than offering an option that then
fails.

Without a `subtotal` it will not claim free delivery — it says nothing rather
than guessing.

### The chosen method is recorded on the order

`shippingMethodLabel` ("Courier — Next Day") is built from the zone's own speed
tier at quote time, persisted on the `ShippingQuote`, and snapshotted onto the
`Order` — the same pattern as `pickupLocationName`. Renaming a speed tier later
therefore cannot rewrite what a past customer bought.

The confirmation page, the customer order page and the admin order page all
render it through one helper, `formatShippingMethod()` in `lib/shop.js`. Each
used to derive its own label from the raw enums, which produced things like
"next day" and would have drifted apart as tiers changed. The helper falls back
to deriving a label for orders placed before the field existed.

### Zone resolution

```
GET /neighborhoods           → buyer picks one, gets its id
POST /shipping/quote { neighborhoodId }
    → resolveZoneByNeighborhoodId()  → ShippingZone → calcShipping()
```

`services/shipping/zoneResolver.js` never returns a zone it is unsure of —
every failure is a typed `ZoneResolutionError`. Callers must catch **that**
specifically and let programming errors propagate; a blanket `try/catch` around
the lookup turns a `TypeError` into a cheap fallback price.

A name-based resolver exists for legacy free-text addresses, cascading exact →
partial → keyword → any-city. Its loosest step can match across cities, so it
is a migration aid: it logs which strategy fired, and the quote reports
`zoneSource` so a fuzzy match is auditable after the fact.

### The no-zone case

With `useDistanceZones` on, a Greater-Accra delivery whose zone cannot be
resolved is **refused** (`ZoneResolutionError`, 400). It is not quoted from a
fallback, because the only fallback available is the cheapest zone — and a
pricing default that errs cheap produces no error, no complaint and no alert,
just margin leaking quietly. A fallback that errs *expensive* gets reported by
a customer within a day; one that errs cheap can run for months.

### Neighbourhood data

116 neighbourhoods ship in `data/neighborhoods.json` (A 18 · B 28 · C 11 ·
D 8 · E 29 · F 22). Each row carries `lat`/`lng`, `distanceKm`, `assignedZone`
and `zoneOverride`.

`distanceKm` is stored **next to** the assignment on purpose: keeping only the
zone throws away the evidence for it, leaving no way to audit an assignment,
re-derive zones after a rate change, or tell a deliberate override from a
data-entry slip.

Distances currently seed as straight-line × 1.3 with `distanceSource:
"estimated"` — real driving distance needs the Maps billing account that is
still disabled. They are never presented as measured. Run
`POST /admin/neighborhoods/recalculate-all` once billing is live.

> **37 rows carry `zoneOverride: true`.** These are where the curated zone is
> dearer than a 1.3× road-factor estimate. Every disagreement runs the *same*
> direction, which points at Accra's real road factor being nearer 1.6–1.8×
> than at bad data. The override flag stops an automated recalculation from
> quietly downgrading them to a cheaper zone. Measure for real before
> "fixing" any of them. Two rows (`Kokrobite`, `West Trassacco`) additionally
> have coordinates that look wrong — a bad geocode is invisible in the UI and
> shows up only as under-charged deliveries.

### Managing areas (Business Settings → Shipping → Delivery areas)

`components/admin/NeighborhoodsSection.jsx` is where assignments are
maintained. It shows, per area: the zone badge, the distance behind it, and
**how that distance was obtained** — `Measured` (Google), `Manual`, or
`Estimated`. That last badge is the honest-data guard: an estimate must never
be mistaken for a measurement, because a zone is only as trustworthy as the
number under it.

The header strip counts areas, measured, estimated and overrides, with per-zone
totals. A standing warning names how many areas are still priced from an
estimate.

- **Edit** changes zone and/or distance inline. Changing the zone by hand sets
  `zoneOverride`, and the UI says so before you save — an override is a business
  decision, so it is recorded rather than inferred.
- **Measure** re-measures one area from the warehouse and reassigns its zone,
  unless it is an override.
- **Measure estimated** batches up to 25 unmeasured areas per run (the server
  caps it — this is the only money-spending loop in the app) and reports how
  many remain.
- **Disable** deactivates; it never deletes, because historical orders
  reference these by id.

Filters (search, city, zone, show-disabled) are server-side. The city list
comes from `GET /admin/neighborhoods/coverage`, not from the filtered rows —
deriving it from the rows would drop every other city from the dropdown the
moment you filtered by one.

### Regional pickup (outside Greater Accra)

Ghana's other 15 regions are seeded by `npm run seed:regions`, each with three
things, because a region is only selectable if an order in it can actually be
completed:

1. a **Location** with `inAccraCore: false`, so the fulfilment gate routes it to
   pickup rather than delivery;
2. a **bus-station PickupLocation** at the regional capital to collect from;
3. a **ShippingZone** carrying `regionalBaseFee` / `regionalPricePerKg`.

It also creates the Nima warehouse origin and switches on `pickupAvailable` —
without that flag every seeded region would be listed but unusable.

Starting rates are banded by rough road distance from Accra and are **defaults
to review**, not measurements:

| Band | Regions | Base | Per kg |
|---|---|---|---|
| Near | Central, Eastern, Volta | GH₵50 | GH₵5 |
| Mid | Ashanti, Western, Western North, Bono, Bono East, Ahafo, Oti | GH₵70 | GH₵7 |
| Far | Northern, Savannah, North East, Upper East, Upper West | GH₵100 | GH₵10 |

Zone rates are create-only here too (`--force-rates` to override).

### Region and city matching is case-insensitive

`locationController` and the calculator compare region/city names with case and
whitespace normalised. The checkout address form used to take the region as
free text, so stored addresses can carry `greater accra`. An exact match on
those returns nothing, and the failure cascades silently: no cities, no
neighbourhoods, `inAccraCore` falsy, and checkout offering bus-station pickup
in a city it should be delivering to. The address form is now a dropdown fed by
`GET /locations/regions`; the loose matching is what rescues addresses saved
before it.

### Seeding

```bash
npm run seed:zones           # six A–F zones — CREATE-ONLY
npm run seed:zones -- --dry-run
npm run seed:zones -- --force-update
npm run seed:neighborhoods   # 116 rows, upsert on { city, name }
npm run seed:regions         # 15 regions + capitals + bus stations + zones
```

The zone seeder is **create-only by default**. Rates are admin-editable at
runtime, so a seeder that blindly re-asserts them will eventually overwrite
live pricing with whatever numbers were current when the file was written; it
reports drift and requires `--force-update` to apply. The neighbourhood seeder
skips any row with `zoneOverride: true`.

## Tamper-proofing

The client sends product ids and quantities; it never sends a price. Three
defences run on `POST /orders`:

1. **Cart hash** — `buildCartHash()` digests the sorted items plus city,
   neighbourhood, method, speed, **region and pickupLocationId**. The order
   controller recomputes it from the *resolved* order lines and compares. Any
   change — including switching between delivery and pickup — invalidates.
2. **Explicit drift checks** on city, neighbourhood and method.
3. **Atomic consumption** — `findOneAndUpdate({ consumed: false })` marks the
   quote used, so a race cannot double-spend one quote.

Quotes self-delete 15 minutes after creation via a MongoDB TTL index.

### The client never supplies the fee

Order creation recomputes server-side. If the body carries `shippingFee` it is
**validated, not trusted**: below the server figure (beyond a GH₵0.50 rounding
tolerance) the order is refused with 409; above it, the value is clamped down.

Echoing the checkout figure back is a legitimate UX goal — the total should not
shift between checkout and confirmation. Satisfy it by validating the echoed
value, never by writing it. The same rule applies to prices, discounts and tax.

## Endpoint Table

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/shipping/quote` | Server-computed shipping quote. Returns `quoteId` for checkout. Rate-limited. |
| `GET` | `/api/v1/shipping/methods` | Available fulfilment methods for a region/city, with indicative fees. Regional cities return `bus_station_pickup` plus the station list. |
| `GET` | `/api/v1/shipping/neighborhoods` | Active neighbourhoods grouped by zone for a city (storefront picker). |
| `GET` | `/api/v1/shipping/free-delivery` | Whether free delivery is enabled, and the threshold. |
| `GET` | `/api/v1/shipping/zones` | The A–F rate table, for a public "what does delivery cost?" page. |
| `GET` | `/api/v1/neighborhoods` | Active neighbourhoods for the checkout picker, grouped city → municipality. Each carries the `id` to send back as `neighborhoodId`. |

### Admin (`protect + restrictTo("admin")`)

| Method | Path | Description |
|--------|------|-------------|
| `GET`/`POST` | `/api/v1/admin/shipping/zones` | List / create shipping zones. |
| `GET`/`PATCH`/`DELETE` | `/api/v1/admin/shipping/zones/:id` | Read / update / delete a zone. |
| `GET`/`POST` | `/api/v1/admin/shipping/tiers` | List / create shipping tiers. |
| `GET`/`PATCH`/`DELETE` | `/api/v1/admin/shipping/tiers/:id` | Read / update / delete a tier. |
| `GET`/`PATCH` | `/api/v1/admin/shipping/settings` | Get / update shipping settings (singleton). |
| `GET`/`PATCH` | `/api/v1/admin/shipping/courier-rate` | Get-or-create / update the courier payout config. |
| `GET` | `/api/v1/admin/shipping/distances` | Every neighbourhood in a city with its measured distance (gaps included). |
| `POST` | `/api/v1/admin/shipping/distances/resolve` | Measure unresolved neighbourhoods via Google. `{ force: true }` re-measures all. |
| `PATCH` | `/api/v1/admin/shipping/distances` | Set one neighbourhood's distance by hand (`source: "manual"`). |
| `GET` | `/api/v1/admin/shipping/delivery-charges` | Aggregated summary (by zone, method, totals). |
| `PATCH` | `/api/v1/admin/shipping/delivery-charges/:id/refund` | Manually mark a delivery charge refunded. |
| `GET`/`POST` | `/api/v1/admin/neighborhoods` | List / create serviceable neighbourhoods. |
| `PATCH`/`DELETE` | `/api/v1/admin/neighborhoods/:id` | Update (a manual zone change sets `zoneOverride`) / deactivate. |
| `POST` | `/api/v1/admin/neighborhoods/:id/recalculate` | Re-measure one distance and reassign its zone (overrides respected). |
| `POST` | `/api/v1/admin/neighborhoods/recalculate-all` | Batch version, capped per request — the only money-spending loop in the app. |
| `GET` | `/api/v1/admin/neighborhoods/coverage` | How many distances are measured vs estimated, and the per-zone counts. |

Locations and pickup stations have their own routers —
`routes/locationRoutes.js` / `routes/adminLocationRoutes.js` and
`routes/pickupRoutes.js` / `routes/adminPickupRoutes.js`.

### Order-related

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/orders` | Create order (with optional `shippingQuoteId`). |
| `PATCH` | `/api/v1/orders/:id` | Update status → triggers settlement on `delivered`. |
| `POST` | `/api/v1/orders/:id/tracking` | Add tracking event → also triggers settlement on `delivered`. |
| `PATCH` | `/api/v1/orders/:id/address` | Change delivery address / fulfilment (blocked once shipped, delivered or cancelled). |

## The three order shipping paths

`createOrder` resolves the fee through one of three paths, in order:

1. **Quote (preferred)** — body carries `shippingQuoteId`. The stored fee is
   used verbatim after the hash and drift checks pass. Tamper-proof.
2. **Fresh recomputation** — body carries `method` + `city` but no quote. The
   calculator runs server-side on reconstituted order lines (weights default to
   unknown, so this path prices conservatively). Used by checkouts that did not
   pre-quote; the frontend always pre-quotes.
3. **Legacy `deliveryZoneId`** — flat fee from the deprecated `DeliveryZone`
   model, kept for backward compatibility.

With none of the three, shipping is free.

## Models

### ShippingZone
Where EazWorld delivers or collects. Fields: `name`, `code`, `city`, `region`,
`inAccraCore`, `pickupMode`, `neighborhoods[]`, `baseRate`, `perKgRate`,
`courierBaseRate`, `courierPerKgRate`, `distanceMinKm`, `distanceMaxKm`,
`distanceBaseFee`, `pricePerKm`, `pricePerKg`, `regionalBaseFee`,
`regionalPricePerKg`, `sameDayMultiplier`, `expressMultiplier`,
`fragileSurcharge`, `estimatedDays`, `isDefault`, `isActive`.

### ShippingTier
Category-based multipliers for the legacy formula. The `__default__` tier is the
fallback for unmapped categories and cannot be deleted. Fields: `name`,
`category`, `level`, `multiplier`, `fragileSurcharge`, `weightThresholdKg`,
`weightSurchargePerKg`, `isActive`.

### ShippingSettings
Singleton. Admin knobs: `freeDeliveryThreshold`, `expressSurcharge`,
`inHouseRadiusKm`, `sameDayCutoffHour`, `deliveryClosedDays[]`, and the
availability flags (`inHouseDeliveryAvailable`, `courierDispatchAvailable`,
`pickupAvailable`, `expressAvailable`).

Distance pricing adds `originAddress` and `useGoogleDistance` — see
**Google-Maps distance pricing** above.

> **`expressSurcharge` is currently inert.** It is stored, validated and
> editable from the admin UI, but no formula reads it — express pricing comes
> entirely from `zone.expressMultiplier`. Either wire it into `computeFee` or
> drop it from the settings surface; leaving it editable invites an admin to
> set it and see nothing change.

### Location
Region → city → neighbourhoods, with the authoritative `inAccraCore` flag that
drives the fulfilment gate.

### PickupLocation
Bus stations (and the Nima warehouse) customers collect from. Orders snapshot
both `pickupLocationId` and `pickupLocationName`, so a later rename or
deactivation never rewrites history.

### Neighborhood
One serviceable delivery area, pre-assigned to a distance zone. Fields: `name`,
`city`, `municipality`, `lat`, `lng`, `distanceKm`, `distanceSource`
(`google` | `manual` | `estimated`), `distanceMeasuredAt`, `assignedZone`
(A–F), `zoneOverride`, `isActive`. Unique on (city, name).

### NeighborhoodDistance
The cached driving distance from `settings.originAddress` to one neighbourhood.
Fields: `region`, `city`, `neighborhood` (lowercased), `originKey`,
`originAddress`, `resolvedAddress`, `distanceKm`, `durationMins`, `source`
(`google` | `manual`), `resolvedAt`. Unique on (region, city, neighborhood).
A side table rather than a field on `Location`, because `Location.neighborhoods`
is a plain string array that the checkout picker, the zone matcher and
`/locations/neighborhoods` all read — a side table is additive.

### ShippingQuote
15-minute TTL document. Stores the computed fee, `grossShippingFee`, and
`cartHash`. Consumed atomically on order creation.

### CourierRate
Singleton payout config. Modes: `percentage`, `flat`, `per_zone`, with a
fallback chain defaulting to 30%.

### DeliveryCharge
One row per delivered order — `courierPayout`, `retainedMargin`, `mode`,
`zoneCode`, `method`. Unique on `orderId` (idempotent). `refunded` set on order
refund.

### Order (shipping fields)
`shippingFee`, `shippingZoneCode`, `shippingZoneName`, `shippingNeighborhood`,
`shippingMethod`, `shippingSpeed`, `shippingQuoteId`, `shippingWeightKg`,
`shippingTierLevel`, `shippingRegion`, `pickupLocationId`,
`pickupLocationName`, `addressHistory[]`. Legacy `deliveryFee` is synced from
`shippingFee` by a pre-save hook.

## Invariant

```
courierPayout + retainedMargin === shippingFeeCollected   (always)
```

Negative margin is surfaced, never clamped — if a discount costs us money, we
want to see it.

## Caching

There are **three** in-process caches in this subsystem, not one. All follow the
same contract: **the TTL is a safety net, an admin write is the invalidation.**

| Cache | Holds | TTL | Invalidated by |
|---|---|---|---|
| `services/shipping/shippingCache.js` | zones, tiers, settings | 300 s | `invalidateAll()` from every admin shipping write |
| `controllers/locationController.js` | the active region → city → neighbourhood taxonomy | 60 s | `invalidateLocationCache()` from every admin location write |
| `controllers/pickupController.js` | active pickup rows | 60 s | `invalidatePickupCache()` from every admin pickup write |

The latter two had **no invalidation at all** until T80p. The TTL alone is not
good enough for a *deactivation*: a city switched off because we stopped
delivering there stayed selectable at checkout for up to a minute, and a
retired bus station stayed bookable — so a customer could select, and pay for,
a handoff point that no longer existed. Both are covered by
`tests/locationEndpoints.test.js` § "admin writes invalidate the public read
cache".

All three are **per process**. See `docs/HOSTING.md` § Open items 4: Passenger
must be pinned to one process, or each instance carries its own copy and an
admin write invalidates only the one that served it.

> **Cache keys must not collide.** The calculator caches *every* active zone
> under the bare `zones` key. Anything caching a filtered subset must use its
> own key — `getNeighborhoods` uses `` `zones:${city}` `` for exactly this
> reason. Writing a city-filtered list to `zones` starves the quote path of
> every other city's zones until the TTL expires, and quotes elsewhere fail
> with `UnsupportedDeliveryAreaError`.

If this app ever runs multiple instances, move to Redis pub/sub invalidation
before scaling out.

## Runbook: "Delivery fee looks wrong"

### 1. Check the quote
```js
db.shippingquotes.findOne({ quoteId: "abc123" })
```
Verify `shippingFee`, `grossShippingFee`, `zoneCode`, `tierLevel`,
`totalWeightKg`, and `weightAssumed` (a `true` here means a product is missing
its catalogue weight).

### 2. Confirm which formula ran
Look at the zone. If it has `regionalBaseFee` and the method is
`bus_station_pickup`, it's the regional formula. If it has `distanceBaseFee`,
`pricePerKm` or `pricePerKg`, it's the E2 distance formula. Otherwise it's the
legacy T78 tier formula — tier multipliers only matter in that last case.

### 2b. If it priced by distance, check the measured number
```js
db.neighborhooddistances.findOne({ city: "Accra", neighborhood: "osu" })
```
The quote's `distanceSource` says which source priced it. `zone_band` when
distance pricing was expected usually means that neighbourhood was never
measured — check Business Settings → Shipping → Neighbourhood distances for the
gap. `originKey` not matching the current origin means the row is stale.

### 3. Check the zone config
```js
db.shippingzones.findOne({ code: "ACC-CENTRAL" })
```
`isActive: true`? `isDefault: true` if no neighbourhood match? Rates correct?

### 4. Check the region gate
```js
db.locations.findOne({ region: "Ashanti", city: "Kumasi" })
```
`inAccraCore` decides delivery vs pickup. A wrong flag here is the usual cause
of "it won't let me choose delivery".

### 5. Check the tier (legacy formula only)
```js
db.shippingtiers.findOne({ category: "Screen Protectors" })
```

### 6. Check the cache
Config is cached for 300 s. Admin writes invalidate automatically; to force it,
`PATCH /api/v1/admin/shipping/settings` with any field.

### 7. Check the calculator
```bash
npx jest tests/shippingCalculator.test.js
```

### 8. Check the settlement
```js
db.deliverycharges.findOne({ orderId: ObjectId("...") })
```
Verify `courierPayout + retainedMargin === shippingFeeCollected`, then check
`db.courierrates.findOne({ code: "COURIER_PAYOUT" })` — mode, percentage,
matching `zoneCode`, `isActive`.

## Tests

```bash
npx jest tests/shipping tests/locationEndpoints.test.js tests/distanceZones.test.js --runInBand
```

`shippingCalculator` (formula units, plus the T80 E2 blocks: same-day cutoff and
Mon–Sat rules, the Greater-Accra distance formula, the regional pickup formula,
and fulfilment-method gating), `shippingEndpoints` (HTTP, validation, auth
gating), `shippingCheckout` (quote → order, hash tamper-proofing including
`region` + `pickupLocationId`, pickup), `shippingSettlement` (courier payout,
refunds, admin summary), `shippingDistance` (Google distance pricing, fallback,
manual overrides), `distanceZones` (the A–F rate table, every worked example,
band boundaries, zone resolution, and the end-to-end far-costs-more-than-near
guard), `locationEndpoints` (the public cascade, the pickup selector, admin CRUD,
the admin-only gate, and cache invalidation), `shippingPickupFulfilment`
(shipped → `readyForPickupAt` → `pickedUpAt`, both status doors, and what the
public tracking endpoint does and does not expose).

Run serially — each suite spins up its own `mongodb-memory-server`, and four at
once can contend enough to flake on a small machine.

## Environment

| Variable | Purpose |
|---|---|
| `WAREHOUSE_LAT` / `WAREHOUSE_LNG` / `WAREHOUSE_ADDRESS` | The fixed origin every neighbourhood distance is measured from. Defaults to Nima, Accra (5.5820038, -0.1984173). Changing it invalidates every stored distance. |
| `GOOGLE_MAPS_API_KEY` | Distance lookups. Needs **billing enabled** on the Cloud project plus the **Routes API** (or the legacy Distance Matrix API on a pre-March-2025 project). Blanked in `tests/setup.js` so no test can bill the account. Absent ⇒ the resolve endpoint 400s and the admin UI offers manual entry only. |

## Running the Seed

```bash
cd backend-eaz && npm run seed:shipping    # zones, tiers, settings
cd backend-eaz && npm run seed:locations   # regions, cities, pickup stations
```

Both are idempotent — safe to run repeatedly.
