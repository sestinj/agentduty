import { NextRequest } from "next/server";
import { handleInboundSMS } from "@/webhooks/twilio";

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const payload = {
    From: formData.get("From") as string,
    Body: formData.get("Body") as string,
    MessageSid: formData.get("MessageSid") as string,
  };

  const twiml = await handleInboundSMS(payload);

  return new Response(twiml, {
    headers: { "Content-Type": "text/xml" },
  });
}
