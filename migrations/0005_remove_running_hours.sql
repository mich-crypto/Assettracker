-- Running hours are not recorded. Past readings keep the stored value; it is
-- no longer asked or shown.
UPDATE asset_types
SET fields = (
  SELECT json_group_array(json(f.value))
  FROM json_each(asset_types.fields) AS f
  WHERE json_extract(f.value, '$.key') <> 'running_hours'
)
WHERE id = 'generator';
