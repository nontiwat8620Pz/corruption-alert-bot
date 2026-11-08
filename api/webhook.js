import crypto from "node:crypto";

export const config = {
  api: {
    bodyParser: false,
  },
};

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

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
    throw new Error("Redis request failed");
  }

  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  if (!REDIS_URL || !REDIS_TOKEN || !CHANNEL_SECRET) {
    return res.status(500).send("Server configuration missing");
  }

  const signature = req.headers["x-line-signature"];

  if (!signature) {
    return res.status(401).send("Missing signature");
  }

  try {
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks);

    const expected = crypto
      .createHmac("sha256", CHANNEL_SECRET)
      .update(rawBody)
      .digest("base64");

    const receivedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      return res.status(401).send("Invalid signature");
    }

    const body = JSON.parse(rawBody.toString("utf8"));

    for (const event of body.events || []) {
      if (event.type === "follow" && event.source?.userId) {
        await redisSet("line:userId", event.source.userId);
      }
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error.message);
    return res.status(500).send("Internal Server Error");
  }
}
