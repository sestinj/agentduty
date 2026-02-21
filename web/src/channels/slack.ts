import { WebClient, type KnownBlock } from "@slack/web-api";

function getSlack() {
  return new WebClient(process.env.SLACK_BOT_TOKEN);
}

/**
 * Convert standard Markdown to Slack mrkdwn format.
 * Key differences: **bold** → *bold*, [text](url) → <url|text>,
 * headers → bold lines.
 */
function markdownToMrkdwn(text: string): string {
  return (
    text
      // Remove shell escape backslashes before punctuation (e.g. \! → !)
      .replace(/\\([!@#$%^&*(){}|;:'",.<>?/`~])/g, "$1")
      // Bold: **text** → *text*
      .replace(/\*\*(.+?)\*\*/g, "*$1*")
      // Italic: remaining standalone _text_ stays as-is (Slack supports _italic_)
      // Links: [text](url) → <url|text>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
      // Headers: # Text → *Text* (bold, since Slack has no headers)
      .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
      // Strikethrough: ~~text~~ → ~text~
      .replace(/~~(.+?)~~/g, "~$1~")
  );
}

const SECTION_CHAR_LIMIT = 3000;

function splitIntoSectionBlocks(text: string): KnownBlock[] {
  if (text.length <= SECTION_CHAR_LIMIT) {
    return [
      { type: "section", text: { type: "mrkdwn", text } },
    ];
  }

  // Split on paragraph boundaries to keep formatting intact.
  const blocks: KnownBlock[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > SECTION_CHAR_LIMIT) {
      if (current) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: current.trimEnd() },
        });
      }
      current = line + "\n";
    } else {
      current += line + "\n";
    }
  }

  if (current.trim()) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: current.trimEnd() },
    });
  }

  return blocks.length > 0
    ? blocks
    : [{ type: "section", text: { type: "mrkdwn", text } }];
}

interface SlackDMOptions {
  slackUserId: string;
  message: string;
  shortCode: string;
  options?: string[];
  notificationId: string;
  threadTs?: string;
}

export async function sendSlackDM({
  slackUserId,
  message,
  shortCode,
  options,
  notificationId,
  threadTs,
}: SlackDMOptions): Promise<{ ts: string; channel: string }> {
  const slackMessage = markdownToMrkdwn(message);
  const displayText = threadTs
    ? slackMessage
    : `*[${shortCode}]* ${slackMessage}`;
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: displayText.slice(0, 3000),
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

  const result = await getSlack().chat.postMessage({
    channel: slackUserId,
    text: threadTs ? slackMessage : `[${shortCode}] ${slackMessage}`,
    blocks,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });

  return {
    ts: result.ts!,
    channel: result.channel!,
  };
}

export async function sendSlackThreadHeader(
  slackUserId: string,
  message: string,
  shortCode: string
): Promise<{ ts: string; channel: string }> {
  const slackMessage = markdownToMrkdwn(message);
  const result = await getSlack().chat.postMessage({
    channel: slackUserId,
    text: `[${shortCode}] ${slackMessage}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*[${shortCode}]* ${slackMessage}`,
        },
      },
    ],
  });

  return {
    ts: result.ts!,
    channel: result.channel!,
  };
}

export async function addSlackReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
  try {
    await getSlack().reactions.add({ name: emoji, channel, timestamp });
  } catch (err: any) {
    if (err?.data?.error === "already_reacted") return;
    throw err;
  }
}

export async function updateSlackMessage(
  channel: string,
  ts: string,
  shortCode: string,
  message: string,
  selectedOption: string
): Promise<void> {
  const slackMessage = markdownToMrkdwn(message);
  await getSlack().chat.update({
    channel,
    ts,
    text: `[${shortCode}] ${slackMessage}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*[${shortCode}]* ${slackMessage}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Selected: *${selectedOption}*`,
          },
        ],
      },
    ],
  });
}
