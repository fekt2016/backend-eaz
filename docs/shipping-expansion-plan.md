# Shipping System Expansion — Implementation Plan (T78 → E2)

Full expansion of the T78 shipping system: replace the fixed `Accra`/`Tema`
delivery-only model with a region/city/neighborhood location system, add a
Nima warehouse + pickup locations, introduce **bus-station pickup** as a
fulfilment method for outside-Greater-Accra, rebuild the pricing engine, and
extend tracking/checkout/admin to match.

This document is the working spec. It is written from the completed Phase 1
codebase study and is intended to be read alongside `docs/shipping.md` (which
will be updated during the documentation phase). Nothing here is code yet —
each phase below is approved before implementation.

---

## 0. Current state (verified)

- **Pricing**: `services/shipping/shippingCalculator.js` is the *only* place a
  fee is computed. Formula: `zone.baseRate × tier.multiplier`, speed
  multiplier, weight surcharge, fragile surcharge. Money is integer pesewas.
- **Methods**: `DELIVERY_METHODS = ['in_house_delivery', 'courier_dispatch']`
  — T78 deliberately removed shop pickup.
- **Locations**: hardcoded `CITIES = ['Accra', 'Tema']` in
  `models/ShippingSettings.js`, `models/ShippingZone.js`, and
  `validation/shippingSchema.js`.
- **Zones**: `ShippingZone` model, neighborhood-matched, per-city fallback
  (`isDefault`). Seeds: Accra Central / Greater Accra Outskirts / Tema Central
  (115 neighborhoods total).
- **Quote flow**: `POST /shipping/quote` → persisted `ShippingQuote` (15-min
  TTL, cartHash SHA-256) → consumed atomically by `POST /orders`.
- **Order**: `Order.shipping*` fields are authoritative; `deliveryFee` synced by
  pre-save hook. Tracking via `trackingHistory[]` + `getOrderTracking`.
- **Warehouse**: Nima, Greater Accra **not yet represented anywhere** in config
  or DB.
- **Tests**: 117 shipping tests pass (`shippingCalculator`, `shippingCheckout`,
  `shippingEndpoints`, `shippingSettlement`).

---

## 1. Location system (region / city / neighborhood)

### Problem
`CITIES` is a hardcoded enum. We now need country-wide coverage split into
deliverable regions, plus a notion of the Nima warehouse and pickup points.

### Decision
Introduce a **`Location`** model that is the single source of truth for
geography, and make zones reference a region instead of a hardcoded city.

### New model `models/Location.js`
```
{
  region:    String,  // 'Greater Accra', 'Ashanti', 'Eastern', 'Central', ...
  city:      String,  // 'Accra', 'Tema', 'Kumasi', 'Koforidua', 'Cape Coast', ...
  neighborhoods: [String],  // lowercased, the selectable list
  inAccraCore: Boolean,     // Greater-Accra-core flag (see pricing)
  isActive:  Boolean,
}
```
- Unique composite index on `{ region, city }`.
- Seeded from `src/seedLocations.js` (all 16 regions, key cities, and the
  Accra 83 + Tema 41 neighborhood lists already gathered in earlier sessions).

### Migration of `ShippingZone`
`ShippingZone.city` (enum `['Accra','Tema']`) becomes `ShippingZone.region`
(free string) — zones are scoped to a **region**, and `Location` drives the
region→neighborhood dropdown. This decouples "where a zone delivers" from the
closed city enum and opens the door to Ashanti/Eastern/etc. later.

### Validation
`validation/shippingSchema.js`: replace `city: z.enum(['Accra','Tema'])` with a
dynamic validator that checks the city exists in `Location` (loaded server-side,
not a hardcoded enum). Quote/methods/zone-create/zone-update schemas updated.

---

## 2. Warehouse + pickup locations

### Problem
The Nima warehouse must be represented (currently it exists nowhere), and
outside Greater Accra we fulfil by **bus-station pickup**, which needs a set of
pickup points the customer chooses from.

### New model `models/PickupLocation.js`
```
{
  name:     String,  // e.g. "Nima Warehouse", "Circle STC Bus Station"
  kind:     String,  // enum: ['warehouse', 'bus_station']
  region:   String,  // Greater Accra for the warehouse, destination for stations
  city:     String,
  address:  String,
  landmark: String,
  isDefault: Boolean,
  isActive: Boolean,
}
```
- The **Nima warehouse** is a `kind: 'warehouse'` row with `isDefault: true` —
  it's the origin for fulfillment and a pickup option for Greater Accra.
- Bus stations are `kind: 'bus_station'` rows, one per served city, that drive
  the pickup dropdown in checkout.

### Endpoint
`GET /api/v1/locations/pickups?region=&city=` → returns pickup locations
(warehouse + relevant stations), admin-CRUD under `/api/v1/admin/locations`.

---

## 3. Fulfilment methods (add bus-station pickup)

### Problem
T78 has delivery only. Requirements add pickup.

### Decision
Expand `DELIVERY_METHODS` in `shippingCalculator.js`:
```
'in_house_delivery'   // Greater Accra home delivery (rider)
'courier_dispatch'    // Greater Accra courier
'bus_station_pickup'  // NEW — outside Greater Accra; deliver to a chosen station/pickup
```

### Method gating (server-validated, never client-truth)
- **Greater Accra** → `in_house_delivery` or `courier_dispatch`.
- **Outside Greater Accra** → `bus_station_pickup` ONLY. A delivery method
  for out-of-region must be rejected (via existing `UnsupportedDeliveryAreaError`
  path / new `InvalidFulfilmentMethodError`).
- The calculator decides region from the `Location` row; fulfillment is derived
  from region, so checkout cannot smuggle a delivery into Ashanti.

### Schema/Order
`Order.shippingMethod` enum gains `'bus_station_pickup'`. New order field
`pickupLocationId` + `pickupLocationName` snapshot (like `shippingZoneName`).

---

## 4. Pricing engine

### Problem
The current formula is zone-tier-speed-weight-fragile, tuned for city delivery.
Greater Accra should be `baseFee + distance×km + weight×kg`, and regional
pickup should be `regionalBaseFee + weight×regionalPerKg`.

### Decision
Keep `shippingCalculator.js` as the single fee source, but **generalize** the
zone to carry both pricing models, then branch on fulfilment type.

`ShippingZone` gains:
```
inAccraCore: Boolean,          // whether this zone is the Greater-Accra core
distanceBaseFee,               // the "baseFee" term
pricePerKm,                    // distance term
pricePerKg,                    // weight term (Greater Accra)
regionalBaseFee,               // regional pickup base (outside GA)
regionalPricePerKg,            // regional pickup weight term
pickupMode: enum['none','bus_station']
```

### Formula branches
```
IF fulfilment === delivery (in_house/courier, Greater Accra):
    fee = distanceBaseFee + (distanceKm × pricePerKm) + (weightKg × pricePerKg)

IF fulfilment === bus_station_pickup (outside GA):
    fee = regionalBaseFee + (weightKg × regionalPricePerKg)
```
- Weight still read from `Product.weight` (DB), `ASSUMED_WEIGHT_KG = 0.5` when
  unknown — unchanged behavior.
- `isFragile` surcharge still applies from product + zone.
- **Distance**: configurable `distanceKm` per zone via the zone's distance band
  (`distanceMinKm`/`distanceMaxKm`) — **no paid external maps API**. We
  estimate distance from the zone band, not geocoding, keeping costs at zero
  and avoiding a new paid dependency (per requirements).
- All outputs remain integer pesewas, rounded half-up.

### Legacy compatibility
Existing `baseRate`/`perKgRate`/tier/speed fields remain for the delivery path
so the current supported Accra/Tema delivery keeps working unchanged; the new
fields are additive.

---

## 5. Checkout frontend

### Current (grounded)
`frontend-eaz/src/app/checkout/page.jsx` today:
- Free-text `city` input, normalized against a **hardcoded `["Accra","Tema"]`**
  whitelist in the component — a city that isn't Accra/Tema silently yields
  "no methods" (page.jsx:83-99).
- Neighborhood **dropdown** fetched from `/shipping/neighborhoods?city=`.
- Delivery methods fetched on city+neighborhood, a quote auto-requested, and
  the payable total computed client-side for display only.
- A **saved-address modal** (`Add a New Address`) with a hardcoded city `<select>`
  (Accra/Tema) + neighborhood dropdown (page.jsx:595-622).
- Saved addresses come from `/auth/me/addresses` (User.shippingAddresses) or
  `localStorage` (`eazworld_shipping_addresses`).

### UX problem the expansion must solve
The component hardcodes both the city whitelist AND the fulfilment model. The
new region/city/pickup model can't live inside the component. The fix is to make
**location data come from the API** (the `Location` model from §1), while keeping
the page's existing interaction patterns (auto-fetch on selection, saved
addresses, address modal, auto-quote).

### Changes (match existing interaction patterns)

1. **Region + city + neighborhood as API-driven cascading dropdowns** in the
   address modal, replacing the hardcoded `["Accra","Tema"]` `<select>`.
   - `GET /api/v1/locations` returns regions → cities → neighborhoods.
   - Selecting a region filters the city `<select>`; city filters the
     neighborhood `<select>` (same pattern the modal already uses for
     neighborhood today, just chained one level up).
   - The free-text city block (page.jsx:83-99) is replaced: `customer.city` is
     now set from the dropdown, so it always resolves and no silent "no
     methods" happens. A new `customer.region` field rides alongside.

2. **Fulfilment method list mirror.** Today the page sorts methods and shows
   buttons with estimated days / "Free". Extend the method cards so that when
   the chosen city resolves to **outside Greater Accra**, the methods come back
   as a single **"Bus Station Pickup"** option (backed by `bus_station_pickup`),
   and a **pickup-location `<select>`** appears populated from
   `GET /api/v1/locations/pickups?region=&city=`. Inside Greater Accra the
   existing delivery buttons remain (+ optional "Pickup at Nima Warehouse" if
   we expose it as a method).

3. **Auto-quote** unchanged in behavior, but the quote request body gains
   `region` (`customer.region`), and when `bus_station_pickup` is selected,
   `pickupLocationId`. A change to region/city/pickup resets the quote the same
   way a method change does today (existing `setShippingQuote(null)` reset
   points).

4. **`handlePlaceOrder`** sends `region` + `pickupLocationId` alongside the
   existing payload. Backend recomputes/validates (never trusts the client).

5. **Confirmation + tracking pages** (`order-confirmation/[reference]`,
   `track/order/[trackingNumber]`) render a pickup panel when
   `shippingMethod === 'bus_station_pickup'`: the chosen pickup point, and
   "Ready for Pickup" in place of the delivery eta (see §7).

6. **Saved addresses** (`/auth/me/addresses` + localStorage) gain `region`
   alongside `city`/`neighborhood` so a saved regional address re-fills the
   cascade. The `User.shippingAddresses` subdoc gets an optional `region` field
   (additive).

7. `lib/shop.js` `formatGhs` unchanged (pesewas at display edge).

---

## 6. Order + Paystack integration

### `orderController.createOrder`
- Accept new params `region`, `pickupLocationId` alongside existing
  `city/neighborhood/method`.
- The `ShippingQuote` route already makes fees tamper-proof (cartHash). Extend
  `buildCartHash` to include `region` + `pickupLocationId` so changing delivery
  mode after quoting invalidates the quote (mirrors existing city/method checks).
- Validate region↔method consistency server-side before any fee math.

### `webhookController` (Paystack)
- Amount validation path already checks `tx.amount === order.total`. No change
  required for pickup, but confirm the `fulfilShopOrder` path doesn't assume a
  street delivery for pickup orders (it currently decrements stock only — pickup
  should not need a rider dispatch step).

### Address change
`changeOrderAddress` recalcs via `quoteShipping`; extend to accept `region` +
`pickupLocationId` and write them to the order.

---

## 7. Tracking statuses

### Current
`ORDER_STATUSES = ['pending','paid','processing','shipped','delivered','cancelled']`
with a forward-only `canTransition`. Separate `Shipment` model is for *supplier
containers / pre-orders* — not customer delivery — and must NOT be touched.

### Decision
Keep the order status flow but make pickup fulfilment visible. Add an
optional **pickup-ready** marker on the order (not a new status enum value, to
avoid breaking existing transitions/reports):
```
order.readyForPickupAt: Date   // staff marks when the parcel is at the chosen pickup point
order.pickedUpAt: Date         // set when status → delivered
```
- Tracking UI shows `status === 'shipped'` + `readyForPickupAt` as
  **"Ready for Pickup"** when `shippingMethod === 'bus_station_pickup'`.
- `getOrderTracking` returns these + the pickup location name.
- `sendShopStatusEmail` (T62) can include the pickup point + hours when relevant
  — **no SMS/WhatsApp** (out of scope per requirements; hook point only).

---

## 8. Admin config

The `business-settings` Shipping tab (already built with `ZonesSection`,
`ZoneRow`, `ZoneForm`, `NeighborhoodInput`) gains:
- **Location management** for regions/cities/neighborhoods (CRUD against
  `Location`).
- **Pickup-location management** (Nima warehouse + bus stations).
- Expand zone form with the new pricing fields (`distanceBaseFee`, `pricePerKm`,
  `regionalBaseFee`, `regionalPricePerKg`, `pickupMode`).
- Existing `useShippingAdmin.js` hooks + `qk.shipping` extended; new hooks for
  locations/pickups.

---

## 9. Seeding & data

- `src/seedLocations.js` — regions, cities, neighborhoods.
- `src/seedShipping.js` — extended: zones carry the new pricing fields, the
  Nima warehouse pickup row is added, Greater Accra (Home Delivery) vs regional
  (Bus Station Pickup) zones are distinct.
- Idempotent, safe to re-run (matches existing pattern).

---

## 10. Tests

New tests (mirroring existing patterns in `shippingCalculator.test.js` +
`shippingCheckout.test.js`):
- `shippingExpansion.test.js`:
  - Greater Accra delivery formula asserts (distance + weight).
  - Regional bus-station pickup formula asserts.
  - Region↔method gating (delivery rejected outside GA; pickup rejected inside).
  - Distance-band estimation, no external API call.
  - Zone/city enum removal doesn't break legacy Accra/Tema delivery.
  - `buildCartHash` includes region + pickupLocationId.
- `shippingPickupFulfilment.test.js`:
  - Quote → order with `pickupLocationId`; ready-for-pickup → delivered flow.
  - Paystack amount validation on pickup orders.
- `locationEndpoints.test.js`: region/city/neighborhood + pickup CRUD + gating.
- Update `tests/setup.js` rules if needed (no feature flags).

Run: `cd backend-eaz && npx jest tests/shipping* tests/locationEndpoints*`.
Frontend: `cd frontend-eaz && npm run lint && npm run build`.

---

## 11. Conflict resolution summary

| Concern | Resolution |
|--------|-----------|
| `ShippingZone` vs `DeliveryZone` | `DeliveryZone` stays deprecated (legacy flat-fee path), untouched. New work is all on `ShippingZone` + `Location`. |
| `CITIES` enum vs open geography | `Location` model becomes source of truth; zone enum relaxed to `region`. Validation dynamically checks `Location`, not a hardcoded list. |
| Existing Accra/Tema delivery | Kept working via legacy `baseRate`/`perKgRate` delivery path; new fields are additive. |
| `Shipment` model collision | `Shipment` is supplier/container pre-order tracking — keep separate; do not reuse for customer pickup. |
| No shop pickup (T78) | Superseded by requirement; reintroduced as `bus_station_pickup` (and Nima warehouse pickup) distinct from the old `shop_pickup`. |
| Paid maps API | Avoided — distance estimated from zone distance bands (no new paid dependency). |

---

## 12. Execution order

1. `models/Location.js` + `models/PickupLocation.js`
2. `ShippingZone` field additions (region + pricing) — additive
3. `shippingCalculator.js` new formula branches + method gating
4. `validation/shippingSchema.js` dynamic location validation
5. `Location`/`PickupLocation` routes + controllers + admin CRUD
6. Order controller: region/pickup params + cartHash extension + webhook confirm + `User.shippingAddresses.region` (additive)
7. Tracking: ready-for-pickup markers + statuses
8. Frontend: checkout cascade + pickup selector + confirmation/tracking UI
9. Admin settings: locations/pickups + zone pricing fields
10. Seeds + tests + lint/build
11. Update `docs/shipping.md`
