import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseInboundMessage } from "./parse-inbound";
import { recordResponse } from "./record-response";

interface TwilioInboundSMS {
  From: string;
  Body: string;
  MessageSid: string;
}

export async function handleInboundSMS(
  payload: TwilioInboundSMS
): Promise<string> {
  const body = payload.Body.trim();
  const from = payload.From;

  // Find user by phone number
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.phone, from));

  if (!user) {
    return twimlResponse("Unknown phone number. Please register your phone in AgentDuty.");
  }

  const result = await parseInboundMessage(body, user.id);

  switch (result.type) {
    case "shortCode":
      await recordResponse(result.notification, user.id, "sms", result.text);
      return twimlResponse("Response recorded.");
    case "optionSelect":
      await recordResponse(result.notification, user.id, "sms", undefined, result.selectedOption);
      return twimlResponse(`Selected: ${result.selectedOption}`);
    case "freeform":
      await recordResponse(result.notification, user.id, "sms", result.text);
      return twimlResponse("Response recorded.");
    case "invalidOption":
      return twimlResponse("Invalid option number.");
    case "notFound":
      return twimlResponse(`No active notification found with code ${result.shortCode}.`);
    case "noActive":
      return twimlResponse("No active notification to respond to.");
  }
}

function twimlResponse(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
}
