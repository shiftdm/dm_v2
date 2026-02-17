-- Cambiar time_stamp de VARCHAR(100) a TIMESTAMP (formato datetime nativo)
-- Ejecutar para cada tabla de leads (ej: leads_9)
--
-- OPCIÓN A (recomendada): Simple, valores existentes se ponen en NULL.
-- Los nuevos envíos guardarán timestamps correctos:

ALTER TABLE leads_9 ALTER COLUMN time_stamp TYPE TIMESTAMP USING NULL;

--
-- OPCIÓN B: Conservar datos en formato "12:58 AM / 2026-01-27" (sin segundos).
-- Comenta la línea de arriba y descomenta las siguientes:

-- ALTER TABLE leads_9 ALTER COLUMN time_stamp TYPE TIMESTAMP USING (
--   CASE
--     WHEN time_stamp IS NULL OR trim(time_stamp) = '' THEN NULL
--     WHEN time_stamp ~ '^\d{1,2}:\d{2}\s*(AM|PM)\s*/\s*\d{4}-\d{2}-\d{2}$' THEN
--       to_timestamp(time_stamp, 'HH12:MI AM / YYYY-MM-DD')
--     ELSE NULL
--   END
-- );

-- Para otras tablas (leads_1, leads_2, etc.), repite cambiando "leads_9".
