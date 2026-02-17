import express from "express";
import dotenv from "dotenv";
import { login } from "./lib/login.js";
import { sendInstagramMessage } from "./lib/messaging.js";
import { toggleStoryViewing } from "./lib/stories.js";
import { runDmLoopLocal } from "./lib/dm_loop_local.js";
import {
  getCurrentUser,
  getCurrentProxy,
  getPage,
} from "./lib/browser.js";
import { log } from "./utils/log.js";
import { ensureBrowserActive } from "./utils/helpers.js";
import {
  checkAndIncrementMessageCount,
  getMessageCount,
} from "./utils/rate_limiter.js";

dotenv.config();

const app = express();
app.use(express.json());

// ---------- ENV CONFIG ----------
const PORT = process.env.PORT || 3001;
const USERNAME = process.env.LOGIN_USERNAME;
const WAIT_BETWEEN_CYCLES_MIN = parseInt(process.env.WAIT_BETWEEN_CYCLES_MIN) || 2;

// ---------- GLOBAL FLAGS ----------
global.isLoopRunning = false;
global.isDMRunning = false;

// ---------- DM LOOP FUNCTION (flujo local, sin n8n) ----------
export async function runDmCycle() {
  try {
    if (!USERNAME) {
      log("[ERROR] LOGIN_USERNAME not set in .env");
      global.isLoopRunning = false;
      return;
    }

    log("🚀 Running local DM loop (no webhooks)...");

    const data = await runDmLoopLocal(USERNAME);

    // Temp block → stop everything
    if (data.temp_block === true) {
      log("🚫 TEMP BLOCK detected — stopping loop");
      global.isLoopRunning = false;
      log("__TEMP_BLOCK_DETECTED__");
      const page = getPage();
      if (page) {
        try {
          const browser = page.browser();
          if (browser) await browser.close().catch(() => {});
        } catch {}
      }
      return;
    }

    log(`✅ Cycle complete: ${data.message}`);

    // Rate limit check
    const userId = USERNAME;
    const rate = await getMessageCount(userId);
    if (rate.count >= rate.limit) {
      log(`[RATE LIMIT] ⚠️ ${userId} reached limit. Loop stopped.`);
      global.isLoopRunning = false;
      return;
    }

    // Wait before next cycle
    if (!global.isLoopRunning) {
      log("🛑 DM loop stopped — not waiting.");
      return;
    }

    const waitTime = WAIT_BETWEEN_CYCLES_MIN * 60 * 1000;
    log(`⏳ Waiting ${WAIT_BETWEEN_CYCLES_MIN} minutes before next cycle...`);
    await new Promise((r) => setTimeout(r, waitTime));

    if (global.isLoopRunning) {
      await runDmCycle();
    } else {
      log("🛑 Loop stopped manually or by system.");
    }
  } catch (err) {
    log(`[FATAL] Error in DM loop: ${err.message}`);
    log("⚠️ Retrying in 5 minutes...");
    await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
    if (global.isLoopRunning) await runDmCycle();
  }
}

// ---------- ROUTES ----------

// Start DM loop (flujo local, sin n8n)
app.post("/start-dm-loop", async (req, res) => {
  try {
    if (global.isLoopRunning)
      return res.status(400).json({ error: "DM loop already running" });

    if (!USERNAME)
      return res.status(400).json({ error: "LOGIN_USERNAME not set in .env" });

    const { getAccountByUsername } = await import("./utils/proxy.js");
    const account = await getAccountByUsername(USERNAME);
    if (!account)
      return res.status(404).json({ error: "Account not found in accounts table" });
    if (account.active === false)
      return res.status(400).json({ error: "Account is inactive. Set active=true to start." });

    const { count, limit } = await getMessageCount(USERNAME);
    if (count >= limit) {
      log(`[RATE LIMIT] 🚫 ${USERNAME} already hit daily limit.`);
      return res
        .status(429)
        .json({ success: false, error: "Rate limit reached" });
    }

    global.isLoopRunning = true;
    log("🔁 Starting continuous DM loop...");
    runDmCycle();
    res.json({ success: true, message: "DM loop started" });
  } catch (err) {
    log(`[FATAL] /start-dm-loop error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Login local (desde BD)
app.post("/login-from-db", async (req, res) => {
  try {
    const { username } = req.body;
    const targetUser = username || USERNAME;
    if (!targetUser)
      return res.status(400).json({ error: "username required" });

    const { getAccountByUsername } = await import("./utils/proxy.js");
    const account = await getAccountByUsername(targetUser);
    if (!account)
      return res.status(404).json({ error: "Account not found in DB" });

    const result = await login(
      account.username,
      account.password,
      account.proxy || undefined
    );
    log(`✅ ${account.username} logged in (from DB)`);
    res.json(result);
  } catch (err) {
    log("[ERROR] /login-from-db: " + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Direct login API
app.post("/login", async (req, res) => {
  const { username, password, proxy } = req.body;
  if (!username || !password)
    return res
      .status(400)
      .json({ success: false, error: "Missing credentials" });

  try {
    const result = await login(username, password, proxy);
    log(`✅ ${username} logged in successfully`);
    res.json(result);
  } catch (err) {
    log("[ERROR] /login " + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- SEND MESSAGE ----------
app.post("/instagram", ensureBrowserActive, async (req, res) => {
  const { to, message } = req.body;
  const userId = getCurrentUser();

  if (!to || !message)
    return res
      .status(400)
      .json({ success: false, error: "Missing 'to' or 'message'" });
  if (!userId)
    return res.status(400).json({ success: false, error: "No user logged in" });

  const limitInfo = await getMessageCount(userId);
  if (limitInfo.count >= limitInfo.limit)
    return res.status(429).json({
      success: false,
      error: `Daily limit (${limitInfo.limit}) exceeded.`,
    });

  try {
    const result = await sendInstagramMessage(to, message);
    if (result.success) await checkAndIncrementMessageCount(userId);

    const updated = await getMessageCount(userId);
    res.json({
      ...result,
      from: userId,
      proxy: getCurrentProxy(),
      messageCount: updated.count,
      messagesRemaining: updated.limit - updated.count,
    });
  } catch (err) {
    log("[ERROR] /instagram", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- STORY VIEW ----------
app.post("/viewstory", ensureBrowserActive, async (req, res) => {
  const { status } = req.body;
  if (!status)
    return res.status(400).json({ success: false, error: "Missing status" });

  try {
    const result = await toggleStoryViewing(status);
    if (result.success) log(`📺 Story viewing ${status}`);
    res.json(result);
  } catch (err) {
    log("[ERROR] /viewstory", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get("/health", async (req, res) => {
  const currentUser = getCurrentUser();
  const rate = currentUser ? await getMessageCount(currentUser) : null;
  const dmRunning = global.isLoopRunning === true;
  res.json({
    ok: true,
    currentUser,
    proxy: getCurrentProxy(),
    rateLimit: rate
      ? { ...rate, messagesRemaining: rate.limit - rate.count }
      : {},
    isLoopRunning: dmRunning,
  });
});

// ---------- 2FA HANDLING ----------

// When Puppeteer detects 2FA
app.post("/2fa-required", (req, res) => {
  const { username } = req.body;
  const message = `🔐 2FA required for ${username}. Waiting for code input...`;
  log(message);
  res.json({ ok: true });
});

// When user submits 2FA code
app.post("/submit-2fa", async (req, res) => {
  const { code } = req.body;
  if (!code)
    return res
      .status(400)
      .json({ success: false, message: "No code received" });

  global._pending2FA = { code, username: process.env.LOGIN_USERNAME };
  log(`📩 2FA code received via API.`);
  res.json({ success: true });
});

// ---------- FAILSAFE ----------
process.on("unhandledRejection", (err) =>
  log("[FATAL] Unhandled rejection: " + err)
);
process.on("uncaughtException", (err) =>
  log("[FATAL] Uncaught exception: " + err)
);

// ---------- START SERVER ----------
app.listen(PORT, "0.0.0.0", () => {
  log(`✅ Server running at http://localhost:${PORT}`);
});
