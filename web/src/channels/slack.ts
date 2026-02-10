import { WebClient, type KnownBlock } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

interface SlackDMOptions {
  slackUserId: string;
  message: string;
  shortCode: string;
  options?: string[];
  notificationId: string;
}

export async function sendSlackDM({
  slackUserId,
  message,
  shortCode,
  options,
  notificationId,
}: SlackDMOptions): Promise<{ ts: string; channel: string }> {
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*[${shortCode}]* ${message}`,
      },
    },
  ];

  if (options && options.length > 0) {
    const buttons = options.map((option, index) => ({
      type: "button" as const,
      text: {
        type: "plain_text" as const,
        text: option,
        emoji: true,
      },
      value: option,
      action_id: `respond_${notificationId}_${index}`,
    }));

    // Add "Other..." button
    buttons.push({
      type: "button" as const,
      text: {
        type: "plain_text" as const,
        text: "Other...",
        emoji: true,
      },
      value: "__other__",
      action_id: `respond_${notificationId}_other`,
    });

    blocks.push({
      type: "actions",
      elements: buttons,
    });
  }

  const result = await slack.chat.postMessage({
    channel: slackUserId,
    text: `[${shortCode}] ${message}`,
    blocks,
  });

  return {
    ts: result.ts!,
    channel: result.channel!,
  };
}
