/**
 * Utilidades para ventana horaria de envíos (8am - 11pm)
 * según timezone de la cuenta
 */

const WINDOW_START_HOUR = 8;  // 8am
const WINDOW_END_HOUR = 23;   // 11pm (exclusivo: hasta 22:59)

/**
 * Obtiene la hora actual (0-23) en la zona horaria dada
 */
export function getCurrentHourInTimezone(timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });
  const hour = parseInt(formatter.format(new Date()), 10);
  return isNaN(hour) ? 12 : hour;
}

/**
 * Indica si estamos dentro de la ventana de envío (8am - 11pm)
 */
export function isInSendingWindow(timezone) {
  const hour = getCurrentHourInTimezone(timezone);
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

/**
 * Devuelve los milisegundos hasta las 8am en la zona horaria.
 * Si ya estamos en ventana, devuelve 0.
 */
export function getMsUntilSendingWindow(timezone) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour").value, 10);
  const minute = parseInt(parts.find((p) => p.type === "minute").value, 10);
  const second = parseInt(parts.find((p) => p.type === "second").value, 10);

  const currentMsFromMidnight = (hour * 3600 + minute * 60 + second) * 1000;

  if (hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR) {
    return 0; // Ya estamos en ventana
  }

  if (hour < WINDOW_START_HOUR) {
    // Esperar hasta 8am hoy
    const msUntil8am = 8 * 3600 * 1000 - currentMsFromMidnight;
    return msUntil8am;
  }

  // hour >= 23: esperar hasta 8am del día siguiente
  const msUntilMidnight = (24 * 3600 * 1000) - currentMsFromMidnight;
  const msUntil8am = msUntilMidnight + 8 * 3600 * 1000;
  return msUntil8am;
}
