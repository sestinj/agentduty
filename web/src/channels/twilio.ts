import twilio from "twilio";

function getClient() {
  // Prefer API key auth over account credentials
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;

  if (apiKeySid && apiKeySecret && accountSid) {
    return twilio(apiKeySid, apiKeySecret, { accountSid });
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (accountSid && authToken) {
    return twilio(accountSid, authToken);
  }

  throw new Error("Twilio credentials not configured");
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
