import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

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

  const result = await client.messages.create({
    body,
    to,
    from: process.env.TWILIO_FROM_NUMBER!,
  });

  return { sid: result.sid };
}
