-- Demo projects DEMOB and DEMOC (DEMO gets hybrids too) with turbines, vessels, hybrid generators, generators and fuel cubes.
-- Not applied by migrations. Needs migration 0013 (hybrid generator). Delete a project in Admin when done.

-- ===== Demo Bravo Offshore (/DEMOB) =====
INSERT OR IGNORE INTO projects (id, slug, name, client, contact_email, geo_mode, billing_enabled, billing_start, billing_startup_cents, billing_monthly_cents, billing_company, billing_address, billing_email, billing_reference) VALUES ('proj-demob', 'DEMOB', 'Demo Bravo Offshore', 'Vestas', 'contact@demob.example', 'live', 1, date('now','-40 days'), 250000, 85000, 'Vestas Wind GmbH', 'Windpark Allee 1
20457 Hamburg', 'ap@demob.example', 'PO-DEMOB');
INSERT OR IGNORE INTO asset_types (id, name, fields, active, project_id) SELECT 'demob-'||id, name, replace(fields, '"pairWith":"fuel-cube"', '"pairWith":"demob-fuel-cube"'), 1, 'proj-demob' FROM asset_types WHERE project_id IS NULL AND active = 1;
INSERT OR IGNORE INTO locations (id, kind, name, lat, lon, radius_m, project_id) VALUES
  ('demob-a01', 'WTG', 'WTG A01', 53.6, 3.2, 300, 'proj-demob'),
  ('demob-a02', 'WTG', 'WTG A02', 53.6, 3.2153, 300, 'proj-demob'),
  ('demob-a03', 'WTG', 'WTG A03', 53.6, 3.2306, 300, 'proj-demob'),
  ('demob-a04', 'WTG', 'WTG A04', 53.6, 3.2459, 300, 'proj-demob'),
  ('demob-b01', 'WTG', 'WTG B01', 53.609, 3.2, 300, 'proj-demob'),
  ('demob-b02', 'WTG', 'WTG B02', 53.609, 3.2153, 300, 'proj-demob'),
  ('demob-b03', 'WTG', 'WTG B03', 53.609, 3.2306, 300, 'proj-demob'),
  ('demob-b04', 'WTG', 'WTG B04', 53.609, 3.2459, 300, 'proj-demob'),
  ('demob-c01', 'WTG', 'WTG C01', 53.618, 3.2, 300, 'proj-demob'),
  ('demob-c02', 'WTG', 'WTG C02', 53.618, 3.2153, 300, 'proj-demob'),
  ('demob-c03', 'WTG', 'WTG C03', 53.618, 3.2306, 300, 'proj-demob'),
  ('demob-c04', 'WTG', 'WTG C04', 53.618, 3.2459, 300, 'proj-demob'),
  ('demob-sov1', 'SOV', 'SOV Bravo Explorer', NULL, NULL, 300, 'proj-demob');
INSERT OR IGNORE INTO assets (id, type_id, serial, name, attributes, project_id, defect, defect_note, defect_at) VALUES
  ('demob-gen01', 'demob-generator', 'B-GEN-350-001', NULL, json_object('kva', '350 kVA', 'manufacturer', 'Caterpillar', 'inspection_due', date('now','+150 days')), 'proj-demob', 0, NULL, NULL),
  ('demob-cub01', 'demob-fuel-cube', 'B-FC-001', NULL, json_object('size', 'Large', 'inspection_due', date('now','+240 days')), 'proj-demob', 0, NULL, NULL),
  ('demob-hyb01', 'demob-hybrid-generator', 'B-HYB-350-001', NULL, json_object('kva', '350 kVA', 'manufacturer', 'Atlas Copco', 'battery_kwh', 200, 'inspection_due', date('now','+300 days')), 'proj-demob', 0, NULL, NULL),
  ('demob-cub02', 'demob-fuel-cube', 'B-FC-002', NULL, json_object('size', 'Small', 'inspection_due', date('now','+200 days')), 'proj-demob', 0, NULL, NULL),
  ('demob-hyb02', 'demob-hybrid-generator', 'B-HYB-030-001', NULL, json_object('kva', '30 kVA', 'manufacturer', 'Pramac', 'battery_kwh', 50, 'inspection_due', date('now','+20 days')), 'proj-demob', 0, NULL, NULL),
  ('demob-hyb03', 'demob-hybrid-generator', 'B-HYB-350-002', NULL, json_object('kva', '350 kVA', 'manufacturer', 'Atlas Copco', 'battery_kwh', 200, 'inspection_due', date('now','+90 days')), 'proj-demob', 0, NULL, NULL),
  ('demob-gen02', 'demob-generator', 'B-GEN-030-001', NULL, json_object('kva', '30 kVA', 'manufacturer', 'Pramac', 'inspection_due', date('now','-4 days')), 'proj-demob', 0, NULL, NULL),
  ('demob-gen03', 'demob-generator', 'B-GEN-030-002', NULL, json_object('kva', '30 kVA', 'manufacturer', 'Atlas Copco', 'inspection_due', date('now','+400 days')), 'proj-demob', 0, NULL, NULL),
  ('demob-hyb04', 'demob-hybrid-generator', 'B-HYB-030-002', NULL, json_object('kva', '30 kVA', 'manufacturer', 'Pramac', 'battery_kwh', 50, 'inspection_due', date('now','+250 days')), 'proj-demob', 0, NULL, NULL),
  ('demob-cub03', 'demob-fuel-cube', 'B-FC-003', NULL, json_object('size', 'Large', 'inspection_due', date('now','+330 days')), 'proj-demob', 0, NULL, NULL),
  ('demob-gen04', 'demob-generator', 'B-GEN-350-002', NULL, json_object('kva', '350 kVA', 'manufacturer', 'Cummins', 'inspection_due', date('now','+10 days')), 'proj-demob', 0, NULL, NULL),
  ('demob-gen05', 'demob-generator', 'B-GEN-350-003', NULL, json_object('kva', '350 kVA', 'manufacturer', 'Cummins', 'inspection_due', date('now','+500 days')), 'proj-demob', 0, NULL, NULL),
  ('demob-hyb05', 'demob-hybrid-generator', 'B-HYB-350-003', NULL, json_object('kva', '350 kVA', 'manufacturer', 'Atlas Copco', 'battery_kwh', 200, 'inspection_due', date('now','+180 days')), 'proj-demob', 1, 'Inverter fault, battery will not charge', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1400 minutes'));
INSERT OR IGNORE INTO tags (code, asset_id, kind) VALUES ('AT-BD0001', 'demob-gen01', 'qr'), ('AT-BD0002', 'demob-cub01', 'qr'), ('AT-BD0003', 'demob-hyb01', 'qr'), ('AT-BD0004', 'demob-cub02', 'qr'), ('AT-BD0005', 'demob-hyb02', 'qr'), ('AT-BD0006', 'demob-hyb03', 'qr'), ('AT-BD0007', 'demob-gen02', 'qr'), ('AT-BD0008', 'demob-gen03', 'qr'), ('AT-BD0009', 'demob-hyb04', 'qr'), ('AT-BD0010', 'demob-cub03', 'qr'), ('AT-BD0011', 'demob-gen04', 'qr'), ('AT-BD0012', 'demob-gen05', 'qr'), ('AT-BD0013', 'demob-hyb05', 'qr');
INSERT OR IGNORE INTO readings (id, asset_id, recorded_at, location_id, location_source, gps_status, lat, lon, accuracy_m, distance_m, data, notes, tag_code, kind, linked_asset_id) VALUES
  ('demob-r001', 'demob-gen01', strftime('%Y-%m-%dT%H:%M:%fZ','now','-180 minutes'), 'demob-a01', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 75, "fuel_cube": true, "alarms": []}', 'Demo reading', 'AT-BD0001', 'check', 'demob-cub01'),
  ('demob-r002', 'demob-cub01', strftime('%Y-%m-%dT%H:%M:%fZ','now','-175 minutes'), 'demob-a01', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 75}', 'Demo reading', 'AT-BD0002', 'check', 'demob-gen01'),
  ('demob-r003', 'demob-hyb01', strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 minutes'), 'demob-a02', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"battery_level": 80, "fuel_level": 100, "fuel_cube": true, "alarms": []}', 'Demo reading', 'AT-BD0003', 'check', 'demob-cub02'),
  ('demob-r004', 'demob-cub02', strftime('%Y-%m-%dT%H:%M:%fZ','now','-85 minutes'), 'demob-a02', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 100}', 'Demo reading', 'AT-BD0004', 'check', 'demob-hyb01'),
  ('demob-r005', 'demob-hyb02', strftime('%Y-%m-%dT%H:%M:%fZ','now','-240 minutes'), 'demob-a03', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"battery_level": 20, "fuel_level": 50, "fuel_cube": false, "alarms": ["Low battery"]}', 'Demo reading', 'AT-BD0005', 'check', NULL),
  ('demob-r006', 'demob-hyb03', strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 minutes'), 'demob-a04', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"battery_level": 100, "fuel_level": 25, "fuel_cube": false, "alarms": []}', 'Demo reading', 'AT-BD0006', 'check', NULL),
  ('demob-r007', 'demob-gen02', strftime('%Y-%m-%dT%H:%M:%fZ','now','-400 minutes'), 'demob-b01', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 50, "fuel_cube": false, "alarms": []}', 'Demo reading', 'AT-BD0007', 'check', NULL),
  ('demob-r008', 'demob-gen03', strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 minutes'), 'demob-sov1', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 100, "fuel_cube": false, "alarms": []}', 'Demo reading', 'AT-BD0008', 'check', NULL),
  ('demob-r009', 'demob-hyb04', strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes'), 'demob-sov1', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"battery_level": 60, "fuel_level": 75, "fuel_cube": false, "alarms": []}', 'Demo reading', 'AT-BD0009', 'check', NULL),
  ('demob-r010', 'demob-cub03', strftime('%Y-%m-%dT%H:%M:%fZ','now','-25 minutes'), 'demob-sov1', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 100}', 'Demo reading', 'AT-BD0010', 'check', NULL),
  ('demob-r011', 'demob-gen04', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3000 minutes'), 'demob-b02', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 25, "fuel_cube": false, "alarms": ["Low fuel"]}', 'Demo reading', 'AT-BD0011', 'check', NULL),
  ('demob-r012', 'demob-hyb05', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1500 minutes'), 'demob-b03', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"battery_level": 40, "fuel_level": 75, "fuel_cube": false, "alarms": []}', 'Demo reading', 'AT-BD0013', 'check', NULL);
INSERT OR IGNORE INTO readings (id, asset_id, recorded_at, location_source, gps_status, data, notes, kind) VALUES ('demob-evt1', 'demob-hyb05', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1400 minutes'), 'manual', 'unavailable', '{"event": "defect", "note": "Inverter fault, battery will not charge"}', NULL, 'event');

-- ===== Demo Charlie Wind (/DEMOC) =====
INSERT OR IGNORE INTO projects (id, slug, name, client, contact_email, geo_mode, billing_enabled, billing_start, billing_startup_cents, billing_monthly_cents, billing_company, billing_address, billing_email, billing_reference) VALUES ('proj-democ', 'DEMOC', 'Demo Charlie Wind', 'Vestas', 'contact@democ.example', 'test', 1, date('now','+20 days'), 250000, 85000, 'Vestas Wind GmbH', 'Windpark Allee 1
20457 Hamburg', 'ap@democ.example', 'PO-DEMOC');
INSERT OR IGNORE INTO asset_types (id, name, fields, active, project_id) SELECT 'democ-'||id, name, replace(fields, '"pairWith":"fuel-cube"', '"pairWith":"democ-fuel-cube"'), 1, 'proj-democ' FROM asset_types WHERE project_id IS NULL AND active = 1;
INSERT OR IGNORE INTO locations (id, kind, name, lat, lon, radius_m, project_id) VALUES
  ('democ-a01', 'WTG', 'WTG A01', 55.1, 7.1, 300, 'proj-democ'),
  ('democ-a02', 'WTG', 'WTG A02', 55.1, 7.1153, 300, 'proj-democ'),
  ('democ-a03', 'WTG', 'WTG A03', 55.1, 7.1306, 300, 'proj-democ'),
  ('democ-a04', 'WTG', 'WTG A04', 55.1, 7.1459, 300, 'proj-democ'),
  ('democ-a05', 'WTG', 'WTG A05', 55.1, 7.1612, 300, 'proj-democ'),
  ('democ-b01', 'WTG', 'WTG B01', 55.109, 7.1, 300, 'proj-democ'),
  ('democ-b02', 'WTG', 'WTG B02', 55.109, 7.1153, 300, 'proj-democ'),
  ('democ-b03', 'WTG', 'WTG B03', 55.109, 7.1306, 300, 'proj-democ'),
  ('democ-b04', 'WTG', 'WTG B04', 55.109, 7.1459, 300, 'proj-democ'),
  ('democ-b05', 'WTG', 'WTG B05', 55.109, 7.1612, 300, 'proj-democ'),
  ('democ-sov1', 'SOV', 'SOV Charlie Star', NULL, NULL, 300, 'proj-democ'),
  ('democ-sov2', 'SOV', 'SOV Charlie Moon', NULL, NULL, 300, 'proj-democ');
INSERT OR IGNORE INTO assets (id, type_id, serial, name, attributes, project_id, defect, defect_note, defect_at) VALUES
  ('democ-gen01', 'democ-generator', 'C-GEN-350-001', NULL, json_object('kva', '350 kVA', 'manufacturer', 'Caterpillar', 'inspection_due', date('now','+150 days')), 'proj-democ', 0, NULL, NULL),
  ('democ-cub01', 'democ-fuel-cube', 'C-FC-001', NULL, json_object('size', 'Large', 'inspection_due', date('now','+240 days')), 'proj-democ', 0, NULL, NULL),
  ('democ-hyb01', 'democ-hybrid-generator', 'C-HYB-350-001', NULL, json_object('kva', '350 kVA', 'manufacturer', 'Atlas Copco', 'battery_kwh', 200, 'inspection_due', date('now','+300 days')), 'proj-democ', 0, NULL, NULL),
  ('democ-cub02', 'democ-fuel-cube', 'C-FC-002', NULL, json_object('size', 'Small', 'inspection_due', date('now','+200 days')), 'proj-democ', 0, NULL, NULL),
  ('democ-hyb02', 'democ-hybrid-generator', 'C-HYB-030-001', NULL, json_object('kva', '30 kVA', 'manufacturer', 'Pramac', 'battery_kwh', 50, 'inspection_due', date('now','+20 days')), 'proj-democ', 0, NULL, NULL),
  ('democ-hyb03', 'democ-hybrid-generator', 'C-HYB-350-002', NULL, json_object('kva', '350 kVA', 'manufacturer', 'Atlas Copco', 'battery_kwh', 200, 'inspection_due', date('now','+90 days')), 'proj-democ', 0, NULL, NULL),
  ('democ-gen02', 'democ-generator', 'C-GEN-030-001', NULL, json_object('kva', '30 kVA', 'manufacturer', 'Pramac', 'inspection_due', date('now','-4 days')), 'proj-democ', 0, NULL, NULL),
  ('democ-gen03', 'democ-generator', 'C-GEN-030-002', NULL, json_object('kva', '30 kVA', 'manufacturer', 'Atlas Copco', 'inspection_due', date('now','+400 days')), 'proj-democ', 0, NULL, NULL),
  ('democ-hyb04', 'democ-hybrid-generator', 'C-HYB-030-002', NULL, json_object('kva', '30 kVA', 'manufacturer', 'Pramac', 'battery_kwh', 50, 'inspection_due', date('now','+250 days')), 'proj-democ', 0, NULL, NULL),
  ('democ-cub03', 'democ-fuel-cube', 'C-FC-003', NULL, json_object('size', 'Large', 'inspection_due', date('now','+330 days')), 'proj-democ', 0, NULL, NULL),
  ('democ-gen04', 'democ-generator', 'C-GEN-350-002', NULL, json_object('kva', '350 kVA', 'manufacturer', 'Cummins', 'inspection_due', date('now','+10 days')), 'proj-democ', 0, NULL, NULL),
  ('democ-gen05', 'democ-generator', 'C-GEN-350-003', NULL, json_object('kva', '350 kVA', 'manufacturer', 'Cummins', 'inspection_due', date('now','+500 days')), 'proj-democ', 0, NULL, NULL),
  ('democ-hyb05', 'democ-hybrid-generator', 'C-HYB-350-003', NULL, json_object('kva', '350 kVA', 'manufacturer', 'Atlas Copco', 'battery_kwh', 200, 'inspection_due', date('now','+180 days')), 'proj-democ', 1, 'Inverter fault, battery will not charge', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1400 minutes'));
INSERT OR IGNORE INTO tags (code, asset_id, kind) VALUES ('AT-CD0001', 'democ-gen01', 'qr'), ('AT-CD0002', 'democ-cub01', 'qr'), ('AT-CD0003', 'democ-hyb01', 'qr'), ('AT-CD0004', 'democ-cub02', 'qr'), ('AT-CD0005', 'democ-hyb02', 'qr'), ('AT-CD0006', 'democ-hyb03', 'qr'), ('AT-CD0007', 'democ-gen02', 'qr'), ('AT-CD0008', 'democ-gen03', 'qr'), ('AT-CD0009', 'democ-hyb04', 'qr'), ('AT-CD0010', 'democ-cub03', 'qr'), ('AT-CD0011', 'democ-gen04', 'qr'), ('AT-CD0012', 'democ-gen05', 'qr'), ('AT-CD0013', 'democ-hyb05', 'qr');
INSERT OR IGNORE INTO readings (id, asset_id, recorded_at, location_id, location_source, gps_status, lat, lon, accuracy_m, distance_m, data, notes, tag_code, kind, linked_asset_id) VALUES
  ('democ-r001', 'democ-gen01', strftime('%Y-%m-%dT%H:%M:%fZ','now','-180 minutes'), 'democ-a01', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 75, "fuel_cube": true, "alarms": []}', 'Demo reading', 'AT-CD0001', 'check', 'democ-cub01'),
  ('democ-r002', 'democ-cub01', strftime('%Y-%m-%dT%H:%M:%fZ','now','-175 minutes'), 'democ-a01', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 75}', 'Demo reading', 'AT-CD0002', 'check', 'democ-gen01'),
  ('democ-r003', 'democ-hyb01', strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 minutes'), 'democ-a02', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"battery_level": 80, "fuel_level": 100, "fuel_cube": true, "alarms": []}', 'Demo reading', 'AT-CD0003', 'check', 'democ-cub02'),
  ('democ-r004', 'democ-cub02', strftime('%Y-%m-%dT%H:%M:%fZ','now','-85 minutes'), 'democ-a02', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 100}', 'Demo reading', 'AT-CD0004', 'check', 'democ-hyb01'),
  ('democ-r005', 'democ-hyb02', strftime('%Y-%m-%dT%H:%M:%fZ','now','-240 minutes'), 'democ-a03', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"battery_level": 20, "fuel_level": 50, "fuel_cube": false, "alarms": ["Low battery"]}', 'Demo reading', 'AT-CD0005', 'check', NULL),
  ('democ-r006', 'democ-hyb03', strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 minutes'), 'democ-a04', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"battery_level": 100, "fuel_level": 25, "fuel_cube": false, "alarms": []}', 'Demo reading', 'AT-CD0006', 'check', NULL),
  ('democ-r007', 'democ-gen02', strftime('%Y-%m-%dT%H:%M:%fZ','now','-400 minutes'), 'democ-a05', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 50, "fuel_cube": false, "alarms": []}', 'Demo reading', 'AT-CD0007', 'check', NULL),
  ('democ-r008', 'democ-gen03', strftime('%Y-%m-%dT%H:%M:%fZ','now','-20 minutes'), 'democ-sov1', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 100, "fuel_cube": false, "alarms": []}', 'Demo reading', 'AT-CD0008', 'check', NULL),
  ('democ-r009', 'democ-hyb04', strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes'), 'democ-sov1', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"battery_level": 60, "fuel_level": 75, "fuel_cube": false, "alarms": []}', 'Demo reading', 'AT-CD0009', 'check', NULL),
  ('democ-r010', 'democ-cub03', strftime('%Y-%m-%dT%H:%M:%fZ','now','-25 minutes'), 'democ-sov1', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 100}', 'Demo reading', 'AT-CD0010', 'check', NULL),
  ('democ-r011', 'democ-gen04', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3000 minutes'), 'democ-b01', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"fuel_level": 25, "fuel_cube": false, "alarms": ["Low fuel"]}', 'Demo reading', 'AT-CD0011', 'check', NULL),
  ('democ-r012', 'democ-hyb05', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1500 minutes'), 'democ-b02', 'gps', 'ok', NULL, NULL, NULL, NULL, '{"battery_level": 40, "fuel_level": 75, "fuel_cube": false, "alarms": []}', 'Demo reading', 'AT-CD0013', 'check', NULL);
INSERT OR IGNORE INTO readings (id, asset_id, recorded_at, location_source, gps_status, data, notes, kind) VALUES ('democ-evt1', 'democ-hyb05', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1400 minutes'), 'manual', 'unavailable', '{"event": "defect", "note": "Inverter fault, battery will not charge"}', NULL, 'event');

-- ===== hybrid generators added to the existing DEMO project =====
INSERT OR IGNORE INTO assets (id, type_id, serial, name, attributes, project_id) VALUES
  ('demo-hyb-01', 'demo-hybrid-generator', 'HYB-350-001', NULL, json_object('kva','350 kVA','manufacturer','Atlas Copco','battery_kwh',200,'inspection_due',date('now','+200 days')), 'proj-demo'),
  ('demo-hyb-02', 'demo-hybrid-generator', 'HYB-030-001', NULL, json_object('kva','30 kVA','manufacturer','Pramac','battery_kwh',50,'inspection_due',date('now','+45 days')), 'proj-demo'),
  ('demo-hyb-03', 'demo-hybrid-generator', 'HYB-350-002', NULL, json_object('kva','350 kVA','manufacturer','Atlas Copco','battery_kwh',200,'inspection_due',date('now','+15 days')), 'proj-demo');
INSERT OR IGNORE INTO tags (code, asset_id, kind) VALUES ('AT-DEMO0101', 'demo-hyb-01', 'qr'), ('AT-DEMO0102', 'demo-hyb-02', 'qr'), ('AT-DEMO0103', 'demo-hyb-03', 'qr');
INSERT OR IGNORE INTO readings (id, asset_id, recorded_at, location_id, location_source, gps_status, data, notes, tag_code, kind) VALUES
  ('demo-hyb-r1', 'demo-hyb-01', strftime('%Y-%m-%dT%H:%M:%fZ','now','-120 minutes'), 'demo-wtg-A04', 'gps', 'ok', '{"battery_level":80,"fuel_level":100,"fuel_cube":false,"alarms":[]}', 'Demo reading', 'AT-DEMO0101', 'check'),
  ('demo-hyb-r2', 'demo-hyb-02', strftime('%Y-%m-%dT%H:%M:%fZ','now','-300 minutes'), 'demo-wtg-B01', 'gps', 'ok', '{"battery_level":20,"fuel_level":75,"fuel_cube":false,"alarms":["Low battery"]}', 'Demo reading', 'AT-DEMO0102', 'check'),
  ('demo-hyb-r3', 'demo-hyb-03', strftime('%Y-%m-%dT%H:%M:%fZ','now','-45 minutes'), 'demo-sov-1', 'gps', 'ok', '{"battery_level":100,"fuel_level":50,"fuel_cube":false,"alarms":[]}', 'Demo reading', 'AT-DEMO0103', 'check');