# AssetTracker

Track generators and other offshore equipment with QR codes and NFC tags. It runs on
Cloudflare (Workers + D1) and has an offline-first phone app for technicians.

| Screen | Path | Who | Purpose |
|---|---|---|---|
| **Overview** | `/overview` | Site manager (also supervisor, admin) | By location: what equipment is on the SOV and on each WTG (e.g. "2 × Generator 30 kVA"), with latest fuel level / fuel cube / alarms, attention flags, map, history, CSV export. No serials or tag codes |
| **Link tags** | `/link` | Warehouse supervisor | Register equipment (type, serial, e.g. 30 kVA / 350 kVA), generate and print QR labels, scan existing QR labels, read/write NFC tags |
| **Scan** | `/field` | Technicians and warehouse supervisor | Scan QR/NFC, auto-detect WTG or SOV by GPS, enter fuel level, fuel cube, alarms. Works offline and syncs later |
| **Setup** | `/admin` | Admin (locations also supervisor) | WTG/SOV locations (CSV import), users and roles, equipment types and their fields |

## How the field app decides the location

With `"GEO_CHECK": "on"` in `wrangler.jsonc`, the phone's GPS fix is compared with the
surveyed WTG positions. The check uses the cached location list, so it works offline
(`public/js/geo.js`). The result is only a **suggestion**: **Change location** always lets the
user pick any WTG, SOV or **Here (phone GPS position)**.

| Situation | Suggested location |
|---|---|
| Fix within a WTG's radius (default 300 m) | That WTG, marked **GPS** |
| Within the wind farm (< 30 km of a WTG) but not at a turbine | The SOV (the user picks one if there are several) |
| Away from the farm (> 30 km): shore, train, warehouse | **Here**, the phone's own GPS position, with no WTG/SOV |
| More than 150 km away | **Here**, with a warning that offshore this can mean GPS jamming |
| No fix, fix older than 2 min, or 0,0 | Nothing: the user selects the location (GPS jamming) |
| Accuracy worse than ±150 m | Nearest WTG, which the user is asked to confirm |

Readings saved at **Here** appear on the overview under **Elsewhere**, with their coordinates
and a map pin. Every reading records whether its location came from GPS or was chosen by
hand, plus the GPS status, raw fix, accuracy and distance to the WTG.

`"GEO_CHECK": "off"` turns the suggestion off completely, and the location is always picked by hand.

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

Go to **Setup → Equipment types** and click **+ New equipment type**, or pick an existing
type to change it. No code, JSON or database change is needed. For each field you choose:

* **Question / label**, e.g. "Lamps working".
* **Answer type**: Number, Text, Yes / No, Choose one, Choose several, or Date.
* **Asked**: on every scan (fuel level, alarms) or once when linking the tag (kVA rating, manufacturer).
* **Required**, and for numbers the unit, min, max and **steps of**. For example, steps of
  25 between 0 and 100 shows 0 / 25 / 50 / 75 / 100 % buttons.
* **Flag on overview when**: the value is at or below / below / above a number, or a
  given answer is picked, or any alarm is ticked.

**+ Add common field** inserts ready-made fields: fuel level, running hours, condition OK,
alarms, manufacturer and next inspection date. A live preview shows the link and scan
forms as they will appear on the phone. Each field gets a data key from its label. The key
never changes, even if the label is renamed later, so past readings stay linked to it.

## Access (no login for now)

`wrangler.jsonc` sets `"AUTH_MODE": "open"`: there are **no logins**. Anyone with the URL can
use every screen. The landing page asks for a name once per phone, and that name is saved
with each reading so the overview still shows who scanned what.

To require accounts later, set `"AUTH_MODE": "login"`, set the `SESSION_SECRET` and
`SETUP_KEY` secrets, and redeploy. Phones that were in open mode are sent to the sign-in
page on their next sync, and their queued readings are kept. Roles then apply as below.

## Roles (login mode)

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
# D1 database "assetdatabase" already exists and is configured in wrangler.jsonc
npm run db:migrate:remote
npx wrangler d1 execute assetdatabase --remote --file=seed/demo.sql   # optional demo data
npm run deploy
```

Open the site, enter your name, then:
1. Setup → import the WTG coordinates (CSV `name,lat,lon`) and add the SOV(s).
2. Link tags → register generators and print or write their tags.

(Login mode only: first run `npx wrangler secret put SESSION_SECRET` and
`npx wrangler secret put SETUP_KEY`, create the admin with the setup key, then add users under Setup.)

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
npm run dev                  # http://localhost:8787 (open mode; add --var AUTH_MODE:login to test logins, setup key: dev-setup-key)
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

In login mode, all endpoints except auth require `Authorization: Bearer <token>`. In open mode no token is needed.

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
