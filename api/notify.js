
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

const CYCLE_MS = 8 * 60 * 60 * 1000;
const ALERT_MINUTES = [10, 5];

async function redisGet(key) {
  const response = await fetch(
    `${REDIS_URL}/get/${encodeURIComponent(key)}`,
    {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    }
  );

  if (!response.ok) throw new Error("Redis GET failed");

  const data = await response.json();
  return data.result;
}

async function redisSet(key, value) {
  const response = await fetch(
    `${REDIS_URL}/set/${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "text/plain",
      },
      body: value,
    }
  );

  if (!response.ok) throw new Error("Redis SET failed");
  return response.json();
}

async function sendLineMessage(userId, message) {
  const response = await fetch(
    "https://api.line.me/v2/bot/message/push",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LINE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: "text", text: message }],
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LINE API error: ${error}`);
  }
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function createMessage(account, minutes, spawnAt) {
  const time = formatTime(spawnAt);

  const header =
    `🎮 7DS: ORIGIN\n` +
    `👤 Account: ${account}\n\n`;

  if (minutes === 10) {
    return (
      `🟢 CORRUPTION ALERT\n${header}` +
      `⏳ Corruption Boss กำลังจะปรากฏ!\n` +
      `🕒 เหลือเวลา: 10 นาที\n` +
      `📅 เวลาเกิดโดยประมาณ: ${time} น.`
    );
  }

  if (minutes === 5) {
    return (
      `🟠 CORRUPTION ALERT\n${header}` +
      `⚠️ Corruption Boss ใกล้ปรากฏแล้ว!\n` +
      `🕒 เหลือเวลา: 5 นาที\n` +
      `📅 เวลาเกิดโดยประมาณ: ${time} น.`
    );
  }

  return (
    `🔴 CORRUPTION ALERT\n${header}` +
    `🚨 CORRUPTION BOSS HAS SPAWNED!\n` +
    `⚔️ บอสผุกร่อนเกิดแล้ว!\n` +
    `📅 เวลาเกิด: ${time} น.`
  );
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  if (!REDIS_URL || !REDIS_TOKEN || !LINE_TOKEN || !CRON_SECRET) {
    return res.status(500).send("Server configuration missing");
  }

  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const userId = await redisGet("line:userId");

    if (!userId) {
      return res.status(200).json({
        message: "Waiting for LINE user to follow the bot",
      });
    }

    const accounts = ["Zephyrus", "PORPXE"];
    const now = Date.now();
    const results = [];

    for (const account of accounts) {
      const key = `boss:${account}`;
      const saved = await redisGet(key);

      if (!saved) {
        results.push(`${account}: timer not configured`);
        continue;
      }

      const state = JSON.parse(saved);

      if (!Number.isFinite(state.spawnAt)) {
        results.push(`${account}: invalid timer`);
        continue;
      }

      if (!state.sent) state.sent = {};

      // Send 10-minute and 5-minute alerts.
      for (const minutes of ALERT_MINUTES) {
        const alertAt = state.spawnAt - minutes * 60000;
        const alertKey = String(minutes);

        if (
          now >= alertAt &&
          now < state.spawnAt &&
          !state.sent[alertKey]
        ) {
          await sendLineMessage(
            userId,
            createMessage(account, minutes, state.spawnAt)
          );

          state.sent[alertKey] = true;
          await redisSet(key, JSON.stringify(state));

          results.push(`${account}: sent ${minutes}-minute alert`);
        }
      }

      // Send spawn alert before moving to the next cycle.
      if (now >= state.spawnAt && !state.sent.spawned) {
        await sendLineMessage(
          userId,
          createMessage(account, 0, state.spawnAt)
        );

        state.sent.spawned = true;
        await redisSet(key, JSON.stringify(state));

        results.push(`${account}: sent boss spawned alert`);

        // Move forward by complete 8-hour cycles.
        const cycles =
          Math.floor((now - state.spawnAt) / CYCLE_MS) + 1;

        state.spawnAt += cycles * CYCLE_MS;
        state.sent = {};

        await redisSet(key, JSON.stringify(state));
      }
    }

    return res.status(200).json({
      success: true,
      results,
    });
  } catch (error) {
    console.error("Notify error:", error.message);
    return res.status(500).send("Notification failed");
  }
}
