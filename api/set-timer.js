
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

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

  if (!response.ok) {
    throw new Error("Redis SET failed");
  }

  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  if (!REDIS_URL || !REDIS_TOKEN || !CRON_SECRET) {
    return res.status(500).send("Server configuration missing");
  }

  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const { account, countdownSeconds } = req.body || {};

    if (!["Zephyrus", "PORPXE"].includes(account)) {
      return res.status(400).json({
        error: "Account must be Zephyrus or PORPXE",
      });
    }

    if (
      !Number.isInteger(countdownSeconds) ||
      countdownSeconds < 1 ||
      countdownSeconds > 86400
    ) {
      return res.status(400).json({
        error: "Countdown must be between 1 and 86400 seconds",
      });
    }

    const state = {
      spawnAt: Date.now() + countdownSeconds * 1000,
      sent: {},
    };

    await redisSet(
      `boss:${account}`,
      JSON.stringify(state)
    );

    return res.status(200).json({
      success: true,
      account,
      spawnAt: new Date(state.spawnAt).toISOString(),
      message: "Boss timer saved",
    });
  } catch (error) {
    console.error("Set timer error:", error.message);

    return res.status(500).send("Failed to save timer");
  }
}
