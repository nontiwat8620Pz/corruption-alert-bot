const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const LINE_LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID;

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
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error("Redis SET failed");
  }

  return response.json();
}

async function redisGet(key) {
  const response = await fetch(
    `${REDIS_URL}/get/${encodeURIComponent(key)}`,
    {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error("Redis GET failed");
  }

  return (await response.json()).result;
}

async function verifyLineUser(idToken) {
  const verifyResponse = await fetch(
    "https://api.line.me/oauth2/v2.1/verify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id_token: idToken,
        client_id: LINE_LOGIN_CHANNEL_ID,
      }),
      cache: "no-store",
    }
  );

  if (!verifyResponse.ok) return false;

  const identity = await verifyResponse.json();
  const linkedUserId = await redisGet("line:userId");
  return Boolean(identity.sub && linkedUserId && identity.sub === linkedUserId);
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
    const { idToken, account, countdownSeconds, referenceTime } = req.body || {};

    if (typeof idToken !== "string" || !idToken) {
      return res.status(401).json({ error: "กรุณาเข้าสู่ระบบ LINE" });
    }

    if (!(await verifyLineUser(idToken))) {
      return res.status(403).json({ error: "บัญชี LINE นี้ไม่มีสิทธิ์ใช้งาน" });
    }

    if (!["Zephyrus", "PORPXE"].includes(account)) {
      return res.status(400).json({ error: "กรุณาเลือกบัญชีให้ถูกต้อง" });
    }

    const seconds = Number(countdownSeconds);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) {
      return res.status(400).json({ error: "เวลานับถอยหลังต้องอยู่ระหว่าง 00:00:01 ถึง 24:00:00" });
    }

    // The page sends the current Bangkok wall-clock time for a consistency check.
    // The trusted server clock remains the actual reference timestamp.
    if (typeof referenceTime !== "string" || !/^\\d{2}:\\d{2}:\\d{2}$/.test(referenceTime)) {
      return res.status(400).json({ error: "ไม่พบเวลาอ้างอิงประเทศไทย" });
    }

    const [hours, minutes, secs] = referenceTime.split(":").map(Number);
    if (hours > 23 || minutes > 59 || secs > 59) {
      return res.status(400).json({ error: "รูปแบบเวลาอ้างอิงไม่ถูกต้อง" });
    }

    const now = Date.now();
    const bangkokNow = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(new Date(now));

    if (bangkokNow !== referenceTime) {
      return res.status(409).json({
        error: "เวลาอ้างอิงเปลี่ยนไปแล้ว กรุณาตรวจสอบเวลาและกดบันทึกอีกครั้ง",
        serverTime: bangkokNow,
      });
    }

    const spawnAt = now + seconds * 1000;
    await redisSet(
      `boss:${account}`,
      JSON.stringify({ spawnAt, sent: {} })
    );

    return res.status(200).json({
      success: true,
      account,
      spawnAt,
      serverTime: now,
    });
  } catch (error) {
    console.error("Offline timer update error:", error.message);
    return res.status(500).json({ error: "ไม่สามารถบันทึกเวลาได้ กรุณาลองใหม่" });
  }
}
