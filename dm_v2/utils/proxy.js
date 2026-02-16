import { pool } from "../db.js";

const DEFAULT_DAILY_LIMIT = 80;

const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

export async function getAccountByUsername(username) {
  try {
    const result = await pool.query(
      `SELECT username, password, proxy, port, table_name, daily_message_limit, timezone, send_interval_minutes 
       FROM accounts WHERE username = $1 LIMIT 1`,
      [username]
    );
    if (result.rowCount === 0) return null;
    return result.rows[0];
  } catch (err) {
    console.error(`[ACCOUNTS] Error getting account for ${username}:`, err.message);
    return null;
  }
}

export async function getTimezoneByUsername(username) {
  try {
    const result = await pool.query(
      `SELECT timezone FROM accounts WHERE username = $1 LIMIT 1`,
      [username]
    );
    if (result.rowCount === 0 || !result.rows[0].timezone) {
      return DEFAULT_TIMEZONE;
    }
    return result.rows[0].timezone;
  } catch (err) {
    console.error(`[ACCOUNTS] Error getting timezone for ${username}:`, err.message);
    return DEFAULT_TIMEZONE;
  }
}

export async function getDailyMessageLimit(username) {
  try {
    const result = await pool.query(
      `SELECT daily_message_limit FROM accounts WHERE username = $1 LIMIT 1`,
      [username]
    );
    if (
      result.rowCount === 0 ||
      result.rows[0].daily_message_limit == null ||
      result.rows[0].daily_message_limit < 1
    ) {
      return DEFAULT_DAILY_LIMIT;
    }
    return Number(result.rows[0].daily_message_limit);
  } catch (err) {
    console.error(
      `[ACCOUNTS] Error getting daily limit for ${username}:`,
      err.message
    );
    return DEFAULT_DAILY_LIMIT;
  }
}

export async function getProxyByUsername(username) {
  try {
    const result = await pool.query(
      `
      SELECT proxy
      FROM accounts
      WHERE username = $1
      LIMIT 1
      `,
      [username]
    );

    if (result.rowCount === 0 || !result.rows[0].proxy) {
      console.log(`[PROXY] No proxy found for ${username}`);
      return null;
    }

    console.log(`[PROXY] Loaded proxy from DB for ${username}`);
    return result.rows[0].proxy;
  } catch (err) {
    console.error(`[PROXY] DB error for ${username}:`, err.message);
    return null;
  }
}
