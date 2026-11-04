# AssetTracker

Track generators and fuel cubes (and other equipment) on offshore wind projects with
QR labels. Runs on Cloudflare Workers + D1 as an offline-first web app for phones.

Each **project** has its own link, for example `oam.eu/BLP` or `oam.eu/HD`. Whoever
has the link (or its QR code) sees that project only.

## Pages

| Page | Address | For | What it does |
|---|---|---|---|
| **Start** | `/` | everyone | Enter a project code; explains unlinked labels |
| **Project home** | `/BLP` | everyone | First visit: how to add the app to the home screen (iPhone, Android, laptop). Then three entry points |
| **Scan** | `/BLP/field` | technicians | Guided questions after scanning a QR label (see below). Works offline |
| **Warehouse** | `/BLP/warehouse` | warehouse supervisor | Add equipment, *Scan equipment* (refuelled, serviced, defect, repaired), equipment list split into SOV and turbines with fuel and status, things to investigate, import from Excel |
| **Add equipment** | `/BLP/add` | warehouse supervisor | Step by step: type, rating / size, lifting points inspection date, serial number, stick the label, scan it |
| **Overview** | `/BLP/overview` | site manager | What is on the vessel and on each turbine, fuel level, ⚠ warnings, map, service report, refuel planning, assign a location by serial number |
| **Admin** | `/admin` | the owner | **Overview** (active projects, equipment in use, money) and **Finance** (invoices, money tracking); per project the tabs Overview, Statistics, Billing, Project details, Equipment types, Settings and QR labels |

## The guided scan (technicians)

Open the app (a short animation), scan the QR label, then one question per screen:

1. **Where are you?** The phone suggests the turbine by GPS: **Confirm** or **Edit**.
2. **Alarms:** tick the active ones, or tap *No alarms*.
3. **Fuel cube:**
   * Known to be here with this generator: *Is the fuel cube still here?* **No** moves the cube back to the vessel without a reading, and the warehouse supervisor is told.
   * Not known: *Fuel cube connected?* **Yes** asks to scan the cube.
   * Scanning a fuel cube asks about its generator in the same way.
   * Not asked on the vessel: a fuel cube is never connected there, so it is recorded as *No*.
4. **Fuel level** (0 / 25 / 50 / 75 / 100 %). With a connected cube the level is recorded for both units.
5. **Ready to save.** A warning is shown if the level is low or an alarm is active.

**Something is wrong** (always on screen): the label does not match the equipment, or the serial is different.
An unknown label can be reported too. These end up under **Warehouse → To investigate**.

The first time, a three-card introduction explains the steps.

## Defect and blocked equipment

Equipment can be marked **defect** (when scanning, under *Something is wrong*, or in the warehouse under *Scan equipment*) and set back with *Repaired*.
Defect equipment and equipment whose **lifting points inspection is overdue** are *blocked*: scanning them shows a red **Do not use** screen and no questions.
In the lists, a red label means blocked and an orange ⚠ means warning. *Serviced* sets the next inspection date and clears alarms. The paper list (Overview → *Paper list (PDF)*) is for when the system is not available.

## Projects, links and onboarding

* **Admin → New project:** name, link (for example `BLP`), client, contact e-mail.
* **Link and onboarding:** the project link as a QR code, a printable **onboarding sheet** (save as PDF if you like),
  a QR image to attach, and a prepared **e-mail** to the contact (opens your e-mail program; attach the QR or sheet).
  The app cannot send e-mail itself yet.
* **Site address:** QR codes and labels contain it permanently. Set your final domain (for example `https://oam.eu`)
  in Admin before printing anything.
* **Settings per project:** location mode, GPS radius per turbine, wind farm area, NFC on/off.
* **Close** makes a project read-only (export all readings to CSV first). **Delete** removes everything in it; you must type its link.
* **No personal names** are stored. People are not asked who they are, and readings carry no user or device name.

## Billing

**Admin → Billing** invoices each project: a **startup fee** (on the first month's invoice) and a **monthly fee** billed in advance.

* **Per project** (open the project): switch billing on, first billed month, fees, company, address, VAT number, VAT treatment
  (charge VAT / reverse charge / none), invoice e-mail, customer PO.
* **Billing settings:** your company details, IBAN, VAT %, currency, payment term, number prefix, text at the bottom, sender address.
* **Automatic:** a daily cron (05:00 UTC) creates the invoices that are due. You choose what happens next: leave a **draft** to check,
  **issue** it (number assigned), or **issue and e-mail** it. Safe to run repeatedly; one invoice per project per month.
  *Create due invoices now* does the same on demand. Up to 12 months are caught up.
* **Invoice life:** draft (editable) → issued (numbered 2026-0001, fixed) → sent → paid. Issued invoices are never deleted; *Void* frees the month again.
  *Manual invoice* covers extra work. Overdue invoices get a *Reminder* button.
* **Customer view:** every invoice has an unguessable link `/invoice/<token>` that shows a clean page; *Print or save as PDF* from there.
* **E-mail:** sent through [Resend](https://resend.com). Set the secret `npx wrangler secret put RESEND_API_KEY`, verify your sender domain in Resend,
  and fill in *Send invoices from* and *Site address*. Without it, *Send* opens your own e-mail program with the link.
* Payments are marked by hand (no payment provider). A project with issued invoices cannot be deleted, only closed. CSV export for your accounting.
* Check numbering, VAT and invoice wording with your accountant before sending real invoices.

## Location: testing and live

| Mode | Phone is at a turbine | Inside the wind farm area | Outside the area / no GPS / jammed |
|---|---|---|---|
| **Testing** | that WTG is suggested | the vessel is suggested | *Here* (phone position) is allowed |
| **Live** | that WTG is suggested | the vessel is suggested | the location **must be chosen by hand**; *Here* does not exist |

The suggestion can always be changed. A vessel has no fixed position. The server also refuses a live-mode reading without a WTG or vessel.
GPS radius and wind farm area (km from the nearest turbine) are project settings.

## Equipment

* **Equipment types** (Admin → project → Equipment types) are per project: a project starts with its own copy of the standard types. They define what is asked: fixed details when adding (rating, size, inspection date) and questions on every scan.
  Yes/No questions can be hidden on the vessel (fuel cube) or link to another type ("scan the fuel cube").
  Date fields can warn when a date is close: the **lifting points inspection** warns 30 days ahead and when overdue.
* **Fuel cube** size (Large / Small) is set when adding it.
* **Refuelled / Serviced** (Warehouse): scan or choose a serial, confirm. *Serviced* asks for the next inspection date.
  Both work offline.
* **Service report** (Overview): inspections due or overdue, and units with alarms. Copy, CSV or print.
* **Refuel planning** (Overview): units on turbines at or below 25 / 50 / 75 %, lowest first.
* **Import from Excel:** download the template (CSV, opens in Excel), fill in one row per unit, save as CSV and import.
  Ratings like `350` and dates like `31-12-2026` are understood. Equipment arrives without labels; attach one by tapping the row in the equipment list.
* **Retire** equipment in the equipment list; its history is kept.

## QR labels

Labels are **generic**: a random code such as `AT-7K3QX9M2PD`, no serial number, no project. Print a batch (Admin → *QR labels to print*)
on sticker sheets, send them to a project, and link each to equipment by scanning it in *Add equipment*.
A label encodes `https://<site>/t/<code>`. Scanning it with the phone's normal camera opens the right project.
A label that is not linked yet shows a message with what to do.

**NFC** (Android Chrome, off by default) is switched on per project in Admin.

## Offline and sync

* The app and its pages are cached by a service worker after the first visit (the project home page prepares the other pages).
* The equipment list, locations and settings are cached on the phone each time the app opens online.
* Everything a technician or warehouse person records is stored in an outbox on the phone first and sent automatically when
  the connection returns (back on the vessel network). *Sync now* forces it.
* Sync is idempotent: each item has an id made on the phone, so a retry is stored once.
  An item the server refuses stays on the phone with the reason.
* Whether a generator and fuel cube are already known to be together is decided on the phone, including scans still waiting to sync.

## Deploy to Cloudflare

The D1 database `assetdatabase` is configured in `wrangler.jsonc`.

```bash
npm install
npx wrangler login
npm run db:migrate:remote        # applies migrations 0001 ... 0012
npm run deploy
```

Then, in the Cloudflare dashboard, add your domain to the Worker (Workers & Pages → assettracker → Settings → Domains & Routes),
for example `oam.eu`. Open `/admin`, create the first project, and hand out its QR code.

Access is by project link only (`AUTH_MODE` is `open`). The admin page is not protected yet: put the site behind
**Cloudflare Access** (Zero Trust) before real use. The older account system (`AUTH_MODE=login`) is still in the code but not used by the pages.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run db:seed:local        # optional: demo project DEMO (12 turbines, a vessel, 8 generators, 3 fuel cubes)
npm run dev                  # http://localhost:8787  ->  /DEMO  and  /admin
npm test                     # unit tests
```

The demo data lives in the project `DEMO`; delete that project in Admin when you are done with it.
Camera, GPS and NFC need HTTPS on a real phone. `localhost` is fine on a desktop.

## Project layout

```
src/index.js        Worker: routing (/api, /t/CODE, /<project>/<page>), security headers
src/api.js          API (project routes under /api/p/<link>/..., admin routes under /api/projects, /api/types)
migrations/         D1 schema (0008 adds projects, 0009 inspection dates)
public/
  index.html project.html field.html add.html warehouse.html overview.html admin.html
  js/app.js         project from the address, API calls, offline cache + sync
  js/field.js       guided scan        js/add.js  add equipment      js/warehouse.js  warehouse hub
  js/overview.js    overview           js/admin.js  admin            js/project.js  project home
  js/fields.js      field definitions, validation, warnings (shared with the Worker)
  js/geo.js         GPS -> WTG / vessel, testing and live mode
  js/pairing.js     generator <-> fuel cube          js/equipment.js, reports.js  names, warnings, reports
  js/coords.js      turbine list / coordinate parser js/importer.js  equipment import
  sw.js             service worker
seed/demo.sql       demo project
test/               node:test unit tests
```

## API summary

Project routes are under `/api/p/<link>`:

| Method | Path | Notes |
|---|---|---|
| GET | `/bootstrap` | settings, types, locations, equipment: the offline copy |
| GET | `/assets` | equipment with where it is and its latest values (overview, reports) |
| POST / PATCH | `/assets`, `/assets/:id`, `/assets/import` | add, edit or retire, bulk import |
| POST | `/assets/:id/move`, `/assets/:id/tags` | place by hand, attach a label |
| POST | `/readings/sync` | batch upload of scans, moves, events (refuel, service) and issues; idempotent |
| GET / POST / PATCH | `/locations`, `/locations/import` | turbines and vessels |
| GET / PATCH | `/issues` | things to investigate |
| GET | `/readings` | for export |

Admin: `/api/projects` (list, create, update, delete) and `/api/types`. Closed projects accept no writes.
