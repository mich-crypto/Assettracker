-- A fuel cube is never connected on the SOV: don't ask there, record "No".
UPDATE asset_types
SET fields = (
  SELECT json_group_array(
    CASE WHEN json_extract(f.value, '$.key') = 'fuel_cube'
      THEN json_set(f.value, '$.sovValue', json('false'))
      ELSE json(f.value) END)
  FROM json_each(asset_types.fields) AS f
)
WHERE id = 'generator';
