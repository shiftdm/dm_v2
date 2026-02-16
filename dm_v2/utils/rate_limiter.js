import fs from "fs";
import path from "path";
import { log } from "../utils/log.js";
import { getDailyMessageLimit, getTimezoneByUsername } from "./proxy.js";

const DATA_FILE = path.join(process.cwd(), "messageCounts.json");

// 🧠 Get today's date in the given timezone (e.g. "America/Argentina/Buenos_Aires")
function getTodayInTimezone(timezone) {
  const now = new Date();
  return now.toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD
}


// 🧩 Safe JSON loader
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error("[RATE LIMITER] ⚠️ Failed to load or parse JSON:", err);
    try {
      fs.renameSync(DATA_FILE, DATA_FILE + ".corrupt-" + Date.now());
      console.warn("[RATE LIMITER] Renamed corrupt file and starting fresh.");
    } catch {}
  }
  return {};
}

// 💾 Atomic + safe JSON writer
function safeWriteJSON(filePath, data) {
  const tmpFile = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpFile, filePath); // atomic replace
  } catch (err) {
    console.error("[RATE LIMITER] Failed to write JSON safely:", err);
  }
}

// 🧮 In-memory data cache
let dailyMessageCounts = loadData();

// 🛡️ Prevent concurrent writes (write lock)
let saving = false;
let pendingSave = false;

function saveData(data) {
  if (saving) {
    pendingSave = true;
    return;
  }

  saving = true;
  fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf8", (err) => {
    saving = false;
    if (err) {
      console.error("[RATE LIMITER] Failed to save data:", err);
    }
    if (pendingSave) {
      pendingSave = false;
      saveData(data);
    }
  });
}

// 🕒 Check + increment count (only if allowed)
export async function checkAndIncrementMessageCount(userId) {
  const [limit, timezone] = await Promise.all([
    getDailyMessageLimit(userId),
    getTimezoneByUsername(userId),
  ]);
  const today = getTodayInTimezone(timezone);
  let userRecord = dailyMessageCounts[userId];

  if (!userRecord || userRecord.date !== today) {
    userRecord = { count: 0, date: today };
    dailyMessageCounts[userId] = userRecord;
  }

  if (userRecord.count >= limit) {
    return { allowed: false };
  }

  // Increment count
  userRecord.count++;
  log(
    `[RATE LIMITER] User ${userId}: ${userRecord.count}/${limit} messages for ${today}`
  );

  safeWriteJSON(DATA_FILE, dailyMessageCounts); // <- atomic safe write
  return { allowed: true };
}

// 🔍 Get user’s message stats
export async function getMessageCount(userId) {
  const [limit, timezone] = await Promise.all([
    getDailyMessageLimit(userId),
    getTimezoneByUsername(userId),
  ]);
  const today = getTodayInTimezone(timezone);
  const record = dailyMessageCounts[userId];

  if (!record || record.date !== today) {
    return { count: 0, limit, date: today };
  }

  return { count: record.count, limit, date: record.date };
}

// 🧼 Cleanup (removes old-day entries per user timezone)
async function cleanupOldData() {
  let changed = false;
  for (const userId of Object.keys(dailyMessageCounts)) {
    const timezone = await getTimezoneByUsername(userId);
    const today = getTodayInTimezone(timezone);
    if (dailyMessageCounts[userId].date !== today) {
      delete dailyMessageCounts[userId];
      changed = true;
    }
  }
  if (changed) safeWriteJSON(DATA_FILE, dailyMessageCounts);
}

// 🕓 Auto cleanup daily (every hour just in case)
setInterval(cleanupOldData, 60 * 60 * 1000);
