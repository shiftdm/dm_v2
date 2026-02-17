-- Agregar columna daily_message_limit a la tabla accounts
-- Ejecutar en bases de datos existentes (solo una vez)

ALTER TABLE accounts ADD COLUMN daily_message_limit INTEGER DEFAULT 80;
