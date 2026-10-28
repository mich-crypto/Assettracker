# AssetTracker

Track generators and other offshore equipment with QR codes and NFC tags. It runs on
Cloudflare (Workers + D1) and has an offline-first phone app for technicians.

| Screen | Path | Who | Purpose |
|---|---|---|---|
| **Overview** | `/overview` | Site manager (also supervisor, admin) | Map and table of where every asset is, latest fuel level / fuel cube / alarms, alerts, history, CSV export |
| **Link tags** | `/link` | Warehouse supervisor | Register equipment (type, serial, e.g. 30 kVA / 350 kVA), generate and print QR labels, scan existing QR labels, read/write NFC tags |
| **Scan** | `/field` | Technicians and warehouse supervisor | Scan QR/NFC, auto-detect WTG or SOV by GPS, enter fuel level, fuel cube, alarms. Works offline and syncs later |
| **Setup** | `/admin` | Admin (locations also supervisor) | WTG/SOV locations (CSV import), users and roles, equipment types and their fields |

## How the field app decides the location

When a tag is scanned, the phone's GPS fix is compared with the surveyed positions of the
WTGs, using the cached location list, so this works offline too (`public/js/geo.js`):

| Situation | Result |
|---|---|
| Fix within a WTG's radius (default 300 m) | That WTG is filled in and marked **GPS** |
| Good fix, but not near any WTG | The asset is on the vessel: the SOV is filled in (the user must pick one if there are several) |
| No fix, fix older than 2 min, or 0,0 | **Manual entry required** (GPS jamming) |
| Fix more than 150 km from every WTG | **Manual entry required** (spoofing / implausible) |
| Accuracy worse than ±150 m | Suggests the nearest WTG but asks the user to confirm |

Each reading stores whether the location came from GPS or was entered manually, the GPS
status, the raw fix, its accuracy and the distance to the WTG. The overview shows a
**GPS** or **Manual** badge for every reading.

## Offline and sync

* The app shell is cached by a service worker (`public/sw.js`). Assets, tags and
  locations are cached in IndexedDB on every online start.
* Readings go into an IndexedDB **outbox** first and never wait for the network.
* The outbox syncs automatically when the connection comes back (`online` event, app
  focus, every 60 s, Background Sync on Android), so it uploads once the phone is back on
  the vessel's network. The **Sync now** button forces it.
* Sync is idempotent. Each reading has a UUID generated on the phone, so a retried
  upload is stored once.
* If the server rejects a reading (for example a tag that was never linked), it stays on
  the phone with the reason shown. It is never dropped silently.
* Sessions last 30 days, so a technician who signed in on the vessel can work offline for
  days.

## QR and NFC

* Tag codes look like `AT-7K3QX9M2PD`. QR labels encode `https://<your-site>/field#t=<code>`,
  so the phone's normal camera app opens the asset directly. The in-app scanner works as
  well (BarcodeDetector, or the bundled jsQR).
* **NFC** uses Web NFC, which works on **Android Chrome** only. On the Link screen you
  can read a tag (its chip serial becomes `NFC-<serial>`) or write the tag URL onto it.
  A tag with the URL written on it also opens the app when tapped with an **iPhone**,
  through the native NFC reader. Writing the URL is recommended.
* One asset can carry several tags, for example a QR label plus an NFC tag.

## Extending to other equipment

Equipment data is defined per **asset type** as a list of fields (Setup → Equipment
types). No code or schema change is needed. The generator type ships with:

```json
[
  {"key":"kva","label":"Rating","type":"select","scope":"asset","required":true,"options":["30 kVA","350 kVA"]},
  {"key":"fuel_level","label":"Fuel level","type":"number","scope":"check","required":true,"min":0,"max":100,"unit":"%","alert":{"below":25}},
  {"key":"fuel_cube","label":"Fuel cube connected","type":"boolean","scope":"check","required":true},
  {"key":"alarms","label":"Active alarms","type":"multiselect","scope":"check","options":["Low fuel","..."],"alert":{"any":true}}
]
```

* `scope: "asset"` fields are filled in once when linking. `scope: "check"` fields are asked on every scan.
* Field types: `number`, `text`, `boolean`, `select`, `multiselect`, `date`.
* `alert` rules (`below`, `above`, `equals`, `any`) flag the asset on the overview.
* The same validation code (`public/js/fields.js`) runs on the phone and on the server.

To add, say, compressors or welding machines, create a new type with its own fields. To
start recording oil level on generators, add a field to the generator type.

## Roles

| Role | Overview | Link tags | Scan | Locations | Users / types |
|---|:-:|:-:|:-:|:-:|:-:|
| technician | | | ✓ | | |
| supervisor | ✓ | ✓ | ✓ | ✓ | |
| manager | ✓ | | ✓ | | |
| admin | ✓ | ✓ | ✓ | ✓ | ✓ |

## Deploy to Cloudflare

```bash
npm install
npx wrangler login
npx wrangler d1 create assettracker          # copy the database_id into wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put SESSION_SECRET       # e.g. output of: openssl rand -base64 48
npx wrangler secret put SETUP_KEY            # one-time key to create the first admin
npm run deploy
```

Open the site, enter the `SETUP_KEY` to create the admin account, then:
1. Setup → import the WTG coordinates (CSV `name,lat,lon`) and add the SOV(s).
2. Setup → add users (supervisors, technicians, managers).
3. Link tags → register generators and print or write their tags.

Technicians should open `/field` once while online and use **Add to Home screen**.

Hardening suggestions for production:
* Put the site behind **Cloudflare Access** (SSO) and/or add a WAF rate-limit rule on
  `/api/auth/login`.
* Use a custom domain. QR labels encode the site URL, so pick the domain before printing labels.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run db:seed:local        # optional: demo wind farm (12 WTGs + 1 SOV)
npm run dev                  # http://localhost:8787, setup key: dev-setup-key
npm test                     # unit tests for location resolution and field validation
```

Camera, GPS and NFC need HTTPS on a real phone. `localhost` is fine on a desktop. For
phone testing use `npx wrangler dev --remote`, or a Cloudflare tunnel.

## Project layout

```
src/                Worker (API)        index.js, api.js, auth.js, http.js
migrations/         D1 schema + generator type
public/             Static PWA
  js/fields.js      field definitions + validation (shared with the Worker)
  js/geo.js         GPS -> WTG/SOV resolution, jamming checks
  js/store.js       IndexedDB cache + outbox
  js/field.js       Scan screen
  js/link.js        Link screen
  js/overview.js    Overview screen
  js/admin.js       Setup screen
  sw.js             service worker
  vendor/           Leaflet, jsQR, qrcode-generator (bundled for offline use; `npm run vendor`)
seed/demo.sql       demo locations
test/               node:test unit tests
```

## API summary

All endpoints except auth require `Authorization: Bearer <token>`.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/setup`, `/api/auth/login` | returns `{ token, user }` |
| GET | `/api/bootstrap` | types, locations, assets and tags for the offline cache |
| GET / POST / PATCH | `/api/assets[/:id]` | list with latest reading; detail with history |
| POST / DELETE | `/api/assets/:id/tags`, `/api/tags/:code` | link or unlink a tag |
| POST | `/api/readings/sync` | batch upload of up to 500 readings, idempotent, per-item result |
| GET | `/api/readings` | filter by `asset_id`, `location_id`, `from`, `to` |
| GET / POST / PATCH | `/api/locations`, `/api/locations/import` | |
| GET / POST / PATCH | `/api/types`, `/api/users` | admin |
