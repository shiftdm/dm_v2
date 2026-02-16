-- Intervalo base entre envíos (minutos) con ±10% aleatorio
-- Solo envía entre 8am y 11pm en la zona horaria de la cuenta

ALTER TABLE accounts ADD COLUMN send_interval_minutes INTEGER DEFAULT 8;
