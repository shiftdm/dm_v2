-- Agregar columna timezone para usar hora según ubicación del proxy
-- Ejecutar en bases de datos existentes (solo una vez)

ALTER TABLE accounts ADD COLUMN timezone VARCHAR(80) DEFAULT 'America/Argentina/Buenos_Aires';
