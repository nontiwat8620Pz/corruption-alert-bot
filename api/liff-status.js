const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const LINE_LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID;

async function redisGet(key) {
  const response = await fetch(
    `${REDIS_URL}/get/${encodeURIComponent(key)}`,
    {
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error("Redis GET failed");
  }

  return (await response.json()).result;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!REDIS_URL || !REDIS_TOKEN || !LINE_LOGIN_CHANNEL_ID) {
    return res.status(500).json({ error: "Server configuration missing" });
  }

  try {
    const idToken = req.body?.idToken;

    if (typeof idToken !== "string" || !idToken) {
      return res.status(401).json({ error: "LINE login required" });
    }

    const verifyResponse = await fetch(
      "https://api.line.me/oauth2/v2.1/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          id_token: idToken,
          client_id: LINE_LOGIN_CHANNEL_ID,
        }),
        cache: "no-store",
      }
    );

    if (!verifyResponse.ok) {
      return res.status(401).json({ error: "Invalid LINE identity token" });
    }

    const identity = await verifyResponse.json();
    const linkedUserId = await redisGet("line:userId");

    if (!identity.sub || !linkedUserId || identity.sub !== linkedUserId) {
      return res.status(403).json({ error: "This LINE account is not authorized" });
    }

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
      };
    }

    return res.status(200).json({
      success: true,
      accounts: timers,
      serverTime: Date.now(),
    });
  } catch (error) {
    console.error("LIFF status error:", error.message);
    return res.status(500).json({ error: "Unable to load boss timers" });
  }
}
