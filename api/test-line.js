const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const db = await fetch(
      `${REDIS_URL}/get/line:userId`,
      {
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`,
        },
      }
    );

    if (!db.ok) throw new Error("Database request failed");

    const userId = (await db.json()).result;

    if (!userId) {
      return res.status(404).send("LINE user not found");
    }

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
          messages: [
            {
              type: "text",
              text: "✅ Corruption Alert เชื่อมต่อ LINE สำเร็จแล้ว! ระบบทดสอบส่งข้อความเรียบร้อย",
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return res.status(200).json({
      success: true,
      message: "Test message sent",
    });
  } catch (error) {
    console.error("Test LINE error:", error.message);
    return res.status(500).send("Test message failed");
  }
}
