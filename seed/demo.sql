-- Demo data for testing (fictional wind farm, generators, readings). Not applied by migrations.
-- Remove with: DELETE FROM readings WHERE asset_id LIKE 'demo-%'; DELETE FROM assets WHERE id LIKE 'demo-%'; DELETE FROM locations WHERE id LIKE 'demo-%';
INSERT OR IGNORE INTO locations (id, kind, name, lat, lon, radius_m) VALUES
  ('demo-wtg-A01', 'WTG', 'WTG A01', 54.00000, 6.00000, 300),
  ('demo-wtg-A02', 'WTG', 'WTG A02', 54.00000, 6.01530, 300),
  ('demo-wtg-A03', 'WTG', 'WTG A03', 54.00000, 6.03060, 300),
  ('demo-wtg-A04', 'WTG', 'WTG A04', 54.00000, 6.04590, 300),
  ('demo-wtg-B01', 'WTG', 'WTG B01', 54.00900, 6.00000, 300),
  ('demo-wtg-B02', 'WTG', 'WTG B02', 54.00900, 6.01530, 300),
  ('demo-wtg-B03', 'WTG', 'WTG B03', 54.00900, 6.03060, 300),
  ('demo-wtg-B04', 'WTG', 'WTG B04', 54.00900, 6.04590, 300),
  ('demo-wtg-C01', 'WTG', 'WTG C01', 54.01800, 6.00000, 300),
  ('demo-wtg-C02', 'WTG', 'WTG C02', 54.01800, 6.01530, 300),
  ('demo-wtg-C03', 'WTG', 'WTG C03', 54.01800, 6.03060, 300),
  ('demo-wtg-C04', 'WTG', 'WTG C04', 54.01800, 6.04590, 300),
  ('demo-sov-1', 'SOV', 'SOV Demo Vessel', NULL, NULL, 300);

-- Demo generators with QR tags. Each one shows a different state on the overview.
-- Tag codes AT-DEMO0001..8 can be typed into the Scan screen (or encoded as QR).
INSERT OR IGNORE INTO assets (id, type_id, serial, name, attributes) VALUES
  ('demo-gen-01', 'generator', 'GEN-350-001', 'Demo - healthy at WTG',        '{"kva":"350 kVA","manufacturer":"Caterpillar"}'),
  ('demo-gen-02', 'generator', 'GEN-350-002', 'Demo - low fuel',              '{"kva":"350 kVA","manufacturer":"Cummins"}'),
  ('demo-gen-03', 'generator', 'GEN-030-001', 'Demo - active alarm',          '{"kva":"30 kVA","manufacturer":"Atlas Copco"}'),
  ('demo-gen-04', 'generator', 'GEN-030-002', 'Demo - on vessel',             '{"kva":"30 kVA","manufacturer":"Atlas Copco"}'),
  ('demo-gen-05', 'generator', 'GEN-030-003', 'Demo - GPS jammed, manual',    '{"kva":"30 kVA","manufacturer":"Pramac"}'),
  ('demo-gen-06', 'generator', 'GEN-350-003', 'Demo - not scanned 10 days',   '{"kva":"350 kVA","manufacturer":"Caterpillar"}'),
  ('demo-gen-07', 'generator', 'GEN-030-004', 'Demo - moved WTG to WTG',      '{"kva":"30 kVA","manufacturer":"Pramac"}'),
  ('demo-gen-08', 'generator', 'GEN-350-004', 'Demo - never scanned (new)',   '{"kva":"350 kVA","manufacturer":"Cummins"}');

INSERT OR IGNORE INTO tags (code, asset_id, kind) VALUES
  ('AT-DEMO0001', 'demo-gen-01', 'qr'),
  ('AT-DEMO0002', 'demo-gen-02', 'qr'),
  ('AT-DEMO0003', 'demo-gen-03', 'qr'),
  ('AT-DEMO0004', 'demo-gen-04', 'qr'),
  ('AT-DEMO0005', 'demo-gen-05', 'qr'),
  ('AT-DEMO0006', 'demo-gen-06', 'qr'),
  ('AT-DEMO0007', 'demo-gen-07', 'qr'),
  ('AT-DEMO0008', 'demo-gen-08', 'qr');

-- Readings, with times relative to when the seed is applied.
INSERT OR IGNORE INTO readings
  (id, asset_id, recorded_at, location_id, location_source, gps_status, lat, lon, accuracy_m, distance_m, data, notes, tag_code)
VALUES
  ('00000000-0000-4000-8000-000000000101', 'demo-gen-01', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'),
   'demo-wtg-A01', 'gps', 'ok', 54.00040, 6.00020, 8, 47, '{"fuel_level":75,"fuel_cube":true,"alarms":[]}', 'Demo reading', 'AT-DEMO0001'),
  ('00000000-0000-4000-8000-000000000201', 'demo-gen-02', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'),
   'demo-wtg-A03', 'gps', 'ok', 54.00010, 6.03070, 6, 15, '{"fuel_level":50,"fuel_cube":false,"alarms":[]}', 'Demo reading', 'AT-DEMO0002'),
  ('00000000-0000-4000-8000-000000000202', 'demo-gen-02', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'),
   'demo-wtg-A03', 'gps', 'ok', 54.00020, 6.03050, 7, 24, '{"fuel_level":25,"fuel_cube":false,"alarms":["Low fuel"]}', 'Demo reading - needs refuel', 'AT-DEMO0002'),
  ('00000000-0000-4000-8000-000000000301', 'demo-gen-03', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'),
   'demo-wtg-B02', 'gps', 'ok', 54.00910, 6.01520, 10, 13, '{"fuel_level":75,"fuel_cube":true,"alarms":["High temperature","Battery fault"]}', 'Demo reading', 'AT-DEMO0003'),
  ('00000000-0000-4000-8000-000000000401', 'demo-gen-04', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 minutes'),
   'demo-sov-1', 'gps', 'ok', 54.03500, 6.08000, 5, NULL, '{"fuel_level":100,"fuel_cube":false,"alarms":[]}', 'Demo reading - on deck', 'AT-DEMO0004'),
  ('00000000-0000-4000-8000-000000000501', 'demo-gen-05', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'),
   'demo-wtg-C04', 'manual', 'no_fix', NULL, NULL, NULL, NULL, '{"fuel_level":50,"fuel_cube":true,"alarms":[]}', 'Demo reading - GPS jammed', 'AT-DEMO0005'),
  ('00000000-0000-4000-8000-000000000601', 'demo-gen-06', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 days'),
   'demo-wtg-C01', 'gps', 'ok', 54.01800, 6.00010, 9, 11, '{"fuel_level":75,"fuel_cube":true,"alarms":[]}', 'Demo reading', 'AT-DEMO0006'),
  ('00000000-0000-4000-8000-000000000701', 'demo-gen-07', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'),
   'demo-wtg-B03', 'gps', 'ok', 54.00900, 6.03060, 8, 6, '{"fuel_level":100,"fuel_cube":true,"alarms":[]}', 'Demo reading', 'AT-DEMO0007'),
  ('00000000-0000-4000-8000-000000000702', 'demo-gen-07', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 hours'),
   'demo-wtg-B04', 'gps', 'ok', 54.00890, 6.04600, 11, 14, '{"fuel_level":75,"fuel_cube":true,"alarms":[]}', 'Demo reading - moved', 'AT-DEMO0007');
