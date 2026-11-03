-- Lifting points inspection: a next-due date on generators and fuel cubes, entered
-- when the equipment is added. A fuel cube's size is also fixed at that point.
UPDATE asset_types
SET fields = json_insert(fields, '$[#]', json('{"key":"inspection_due","label":"Lifting points inspection due","type":"date","scope":"asset","required":true,"dueWarnDays":30}'))
WHERE id = 'generator' AND fields NOT LIKE '%inspection_due%';

UPDATE asset_types
SET fields = '[
    {"key":"size","label":"Size","type":"select","scope":"asset","required":true,"options":["Large","Small"]},
    {"key":"inspection_due","label":"Lifting points inspection due","type":"date","scope":"asset","required":true,"dueWarnDays":30},
    {"key":"fuel_level","label":"Fuel level","type":"number","scope":"check","required":true,"min":0,"max":100,"step":25,"unit":"%","alert":{"atMost":25}}
  ]'
WHERE id = 'fuel-cube';
