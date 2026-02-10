import twilio from "twilio";

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set");
  }
  return twilio(sid, token);
}

interface SMSOptions {
  to: string;
  message: string;
  shortCode: string;
  options?: string[];
}

export async function sendSMS({
  to,
  message,
  shortCode,
  options,
}: SMSOptions): Promise<{ sid: string }> {
  let body = `[${shortCode}] ${message}`;

  if (options && options.length > 0) {
    body += "\n\nReply with:";
    options.forEach((option, index) => {
      body += `\n${index + 1}. ${option}`;
    });
    body += `\n\nOr reply "${shortCode} <your response>"`;
  } else {
    body += `\n\nReply "${shortCode} <your response>"`;
  }

  const result = await getClient().messages.create({
    body,
    to,
    from: process.env.TWILIO_FROM_NUMBER!,
  });

  return { sid: result.sid };
}
