-- Control de loop por cuenta: active=false detiene el envío de DMs
-- UPDATE accounts SET active = false WHERE username = 'x' para pausar
-- UPDATE accounts SET active = true WHERE username = 'x' para reanudar

ALTER TABLE accounts ADD COLUMN active BOOLEAN DEFAULT true;
