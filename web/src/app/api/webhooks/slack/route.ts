import { NextRequest } from "next/server";
import {
  handleSlackInteraction,
  handleSlackEvent,
} from "@/webhooks/slack";

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";

  // Slack interaction payloads come as application/x-www-form-urlencoded
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    const payloadStr = formData.get("payload");
    if (typeof payloadStr === "string") {
      const payload = JSON.parse(payloadStr);
      return handleSlackInteraction(payload);
    }
    return new Response("Bad Request", { status: 400 });
  }

  // Slack event payloads come as application/json
  const payload = await request.json();
  return handleSlackEvent(payload);
}
