import crypto from "crypto";
import { NextRequest } from "next/server";
import {
  handleSlackInteraction,
  handleSlackEvent,
} from "@/webhooks/slack";

function verifySlackSignature(
  body: string,
  timestamp: string | null,
  signature: string | null
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;

  // Reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(baseString)
    .digest("hex");
  const expected = `v0=${hmac}`;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

export async function POST(request: NextRequest) {
  // Dedup Slack retries — if Slack is retrying, we already processed this event
  if (request.headers.get("x-slack-retry-num")) {
    return new Response("OK");
  }

  const body = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");

  // Verify signature (skip for url_verification challenges)
  const parsed = tryParseJSON(body);
  const isChallenge = parsed?.type === "url_verification";

  if (!isChallenge && !verifySlackSignature(body, timestamp, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const contentType = request.headers.get("content-type") || "";

  // Slack interaction payloads come as application/x-www-form-urlencoded
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(body);
    const payloadStr = params.get("payload");
    if (typeof payloadStr === "string") {
      const payload = JSON.parse(payloadStr);
      return handleSlackInteraction(payload);
    }
    return new Response("Bad Request", { status: 400 });
  }

  // Slack event payloads come as application/json
  if (parsed) {
    try {
      return await handleSlackEvent(parsed);
    } catch (err) {
      console.error("Slack event handler error:", err);
      return new Response("OK");
    }
  }

  return new Response("Bad Request", { status: 400 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tryParseJSON(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
