-- Demo locations for local testing (fictional wind farm). Not applied by migrations.
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
