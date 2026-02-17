/**
 * Flujo local de DM - reemplaza n8n
 * Basado en: Universal-docker-dm-automation.json
 */

import { pool } from "../db.js";
import { getAccountByUsername } from "../utils/proxy.js";
import { login } from "./login.js";
import { sendInstagramMessage } from "./messaging.js";
import { toggleStoryViewing } from "./stories.js";
import { getCurrentUser, getPage } from "./browser.js";
import { log } from "../utils/log.js";
import {
  checkAndIncrementMessageCount,
  getMessageCount,
} from "../utils/rate_limiter.js";
import { getMsUntilSendingWindow } from "../utils/schedule.js";

// Delays configurables (minutos) - mismos que n8n
const DELAY_STORIES_MIN = parseInt(process.env.DELAY_STORIES_MIN) || 3;
const DELAY_STORIES_MAX = parseInt(process.env.DELAY_STORIES_MAX) || 5;
const LEADS_PER_CYCLE = parseInt(process.env.LEADS_PER_CYCLE) || 15;
const DEFAULT_SEND_INTERVAL_MIN = 8;

function randomDelayMinutes(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

/** Intervalo entre envíos: base * (0.9 a 1.1) para simular uso natural */
function getSendIntervalWithJitter(baseMinutes) {
  const base = baseMinutes > 0 ? baseMinutes : DEFAULT_SEND_INTERVAL_MIN;
  const factor = 0.9 + Math.random() * 0.2; // ±10%
  return Math.round(base * factor * 10) / 10; // 1 decimal
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Validar nombre de tabla (solo alfanumérico y guión bajo)
function safeTableName(name) {
  if (!name || typeof name !== "string") return null;
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, "");
  return sanitized || null;
}

export async function runDmLoopLocal(username) {
  let page = getPage();
  let browserHealthy = page && !page.isClosed();

  // 1. Obtener cuenta de la BD
  const account = await getAccountByUsername(username);
  if (!account) {
    log(`[ERROR] ❌ Account not found in DB: ${username}`);
    return { success: false, temp_block: false, message: "Account not found" };
  }

  if (account.active === false) {
    log(`🛑 Account ${username} is inactive — stopping loop.`);
    global.isLoopRunning = false;
    return { success: true, temp_block: false, message: "Loop stopped (account inactive)" };
  }

  const { password, proxy, table_name, send_interval_minutes, timezone } = account;
  const leadsTable = safeTableName(table_name) || "leads";
  const tz = timezone || "America/Argentina/Buenos_Aires";
  const intervalBase = send_interval_minutes > 0 ? send_interval_minutes : DEFAULT_SEND_INTERVAL_MIN;

  // 2. Esperar ventana horaria (8am - 11pm en timezone de la cuenta)
  const msUntilWindow = getMsUntilSendingWindow(tz);
  if (msUntilWindow > 0) {
    const mins = Math.ceil(msUntilWindow / 60000);
    log(`⏰ Fuera de ventana (8am-11pm). Esperando ${mins} min hasta 8am...`);
    await sleep(msUntilWindow);
  }

  // 3. Verificar rate limit
  const { count, limit } = await getMessageCount(username);
  if (count >= limit) {
    log(`[RATE LIMIT] 🚫 ${username} reached daily limit (${count}/${limit})`);
    return { success: false, temp_block: false, message: "Daily limit reached" };
  }

  log(`[RATE LIMIT] ✅ ${username}: ${count}/${limit} messages used today`);

  // 4. Login si no hay sesión
  const currentUser = getCurrentUser();
  if (!currentUser || !browserHealthy) {
    log("[INFO] Browser invalid or not logged in — performing login...");
    const loginResult = await login(username, password, proxy || undefined);
    if (!loginResult.success) {
      log(`[ERROR] Login failed: ${loginResult.message}`);
      return { success: false, temp_block: false, message: loginResult.message };
    }
    page = getPage();
  }

  // 5. Obtener leads pendientes (status vacío o null)
  let leads;
  try {
    const res = await pool.query(
      `SELECT id, username, message FROM ${leadsTable} 
       WHERE (status IS NULL OR status = '') 
       ORDER BY id ASC LIMIT $1`,
      [LEADS_PER_CYCLE]
    );
    leads = res.rows;
  } catch (err) {
    log(`[ERROR] DB error fetching leads: ${err.message}`);
    return { success: false, temp_block: false, message: err.message };
  }

  if (!leads || leads.length === 0) {
    log("⚠️ No pending leads found");
    return { success: true, temp_block: false, message: "No leads to send" };
  }

  log(`📋 Found ${leads.length} leads to process`);

  let tempBlockDetected = false;

  for (const lead of leads) {
    if (!global.isLoopRunning) break;

    // Re-verificar si la cuenta sigue activa antes de cada envío
    const accountCheck = await getAccountByUsername(username);
    if (accountCheck && accountCheck.active === false) {
      log(`🛑 Account ${username} set to inactive — stopping loop.`);
      global.isLoopRunning = false;
      break;
    }

    // Esperar ventana horaria antes de cada envío (por si pasamos de 11pm)
    const msUntil = getMsUntilSendingWindow(tz);
    if (msUntil > 0) {
      log(`⏰ Pasó 11pm. Esperando hasta 8am para continuar...`);
      await sleep(msUntil);
    }

    // Verificar rate limit antes de cada envío
    const rateCheck = await getMessageCount(username);
    if (rateCheck.count >= rateCheck.limit) {
      log(`[RATE LIMIT] Stopping — limit reached`);
      break;
    }

    log(`📤 Sending DM to @${lead.username}...`);

    try {
      const result = await sendInstagramMessage(
        lead.username,
        lead.message || ""
      );

      if (result.temp_block === true) {
        log("🚫 TEMP BLOCK detected — stopping loop");
        tempBlockDetected = true;
        const errTs = new Date();
        await pool.query(
          `UPDATE ${leadsTable} SET status = $1, time_stamp = $2 WHERE id = $3`,
          [`not-send ( Error: ${result.error || "temp block"} )`, errTs, lead.id]
        );
        break;
      }

      if (result.success) {
        await checkAndIncrementMessageCount(username);
        const now = new Date();
        await pool.query(
          `UPDATE ${leadsTable} SET status = 'send', time_stamp = $1 WHERE id = $2`,
          [now, lead.id]
        );
        log(`✅ Lead ${lead.id} marked as sent`);

        // Mantenimiento: ver stories
        log("📺 Starting story viewing...");
        await toggleStoryViewing("start");

        const delayStories = randomDelayMinutes(DELAY_STORIES_MIN, DELAY_STORIES_MAX);
        log(`🧠 Simulating user actions | Delay ${delayStories}m`);
        await sleep(delayStories * 60 * 1000);

        await toggleStoryViewing("stop");
        log("📺 Story viewing stopped");

        // Espera entre leads: send_interval_minutes ±10% (simula uso natural)
        const delayBetween = getSendIntervalWithJitter(intervalBase);
        log(`⏳ Esperando ${delayBetween}m antes del próximo envío (intervalo ${intervalBase}m ±10%)...`);
        await sleep(delayBetween * 60 * 1000);
      } else {
        // Error al enviar (no temp block)
        const errTs = new Date();
        await pool.query(
          `UPDATE ${leadsTable} SET status = $1, time_stamp = $2 WHERE id = $3`,
          [`not-send ( Error: ${result.error || "unknown"} )`, errTs, lead.id]
        );
        log(`❌ Lead ${lead.id} failed: ${result.error}`);
      }
    } catch (err) {
      log(`[ERROR] Processing lead ${lead.id}: ${err.message}`);
      const errTs = new Date();
      await pool.query(
        `UPDATE ${leadsTable} SET status = $1, time_stamp = $2 WHERE id = $3`,
        [`not-send ( Error: ${err.message} )`, errTs, lead.id]
      );
    }
  }

  return {
    success: !tempBlockDetected,
    temp_block: tempBlockDetected,
    message: tempBlockDetected ? "Instagram temporary block" : "done sending message",
  };
}
