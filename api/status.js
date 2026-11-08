const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

async function redisGet(key) {
  const response = await fetch(
    `${REDIS_URL}/get/${encodeURIComponent(key)}`,
    {
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Redis GET failed");
  }

  return (await response.json()).result;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  if (!REDIS_URL || !REDIS_TOKEN || !CRON_SECRET) {
    return res.status(500).send("Server configuration missing");
  }

  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const userId = await redisGet("line:userId");

    const accounts = ["Zephyrus", "PORPXE"];
    const timers = {};

    for (const account of accounts) {
      const saved = await redisGet(`boss:${account}`);

      if (!saved) {
        timers[account] = null;
        continue;
      }

      const state = JSON.parse(saved);

      timers[account] = {
        spawnAt: state.spawnAt,
        spawnTime: new Date(state.spawnAt).toISOString(),
        sentAlerts: state.sent || {},
      };
    }

    return res.status(200).json({
      success: true,
      lineConnected: Boolean(userId),
      accounts: timers,
    });
  } catch (error) {
    console.error("Status error:", error.message);
    return res.status(500).send("Status check failed");
  }
}
