import { WebClient } from "@slack/web-api";
import { db } from "@/db";
import {
  notifications,
  deliveries,
  users,
  agentSessions,
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { parseInboundMessage } from "./parse-inbound";
import { recordResponse } from "./record-response";
import { updateSlackMessage } from "@/channels/slack";

function getSlack() {
  return new WebClient(process.env.SLACK_BOT_TOKEN);
}

interface SlackInteractionPayload {
  type: string;
  user: { id: string };
  actions?: Array<{
    action_id: string;
    value: string;
  }>;
  container?: {
    message_ts: string;
    channel_id: string;
  };
  view?: {
    callback_id: string;
    private_metadata: string;
    state: {
      values: Record<string, Record<string, { value: string }>>;
    };
  };
  trigger_id?: string;
}

interface SlackEventPayload {
  type: string;
  event?: {
    type: string;
    user: string;
    text: string;
    thread_ts?: string;
    channel: string;
    channel_type?: string;
    subtype?: string;
    ts: string;
    bot_id?: string;
    files?: Array<{
      id: string;
      mimetype: string;
      name: string;
      permalink: string;
      url_private: string;
    }>;
  };
  challenge?: string;
}

export async function handleSlackInteraction(
  payload: SlackInteractionPayload
): Promise<Response> {
  if (payload.type === "block_actions" && payload.actions?.length) {
    const action = payload.actions[0];
    const actionId = action.action_id;

    // Parse action_id: respond_{notificationId}_{index|other}
    const match = actionId.match(/^respond_([^_]+)_(.+)$/);
    if (!match) return new Response("OK");

    const notificationId = match[1];
    const optionIndex = match[2];

    const [notification] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notificationId));

    if (!notification) return new Response("OK");

    // Find user by slack ID
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.slackUserId, payload.user.id));

    if (!user) return new Response("OK");

    // "Other..." button opens a modal for custom response
    if (optionIndex === "other" && payload.trigger_id) {
      await getSlack().views.open({
        trigger_id: payload.trigger_id,
        view: {
          type: "modal",
          callback_id: `respond_modal`,
          private_metadata: JSON.stringify({
            notificationId: notification.id,
          }),
          title: {
            type: "plain_text",
            text: "Custom Response",
          },
          submit: {
            type: "plain_text",
            text: "Send",
          },
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*[${notification.shortCode}]* ${notification.message}`,
              },
            },
            {
              type: "input",
              block_id: "response_block",
              element: {
                type: "plain_text_input",
                action_id: "response_text",
                multiline: true,
                placeholder: {
                  type: "plain_text",
                  text: "Type your response...",
                },
              },
              label: {
                type: "plain_text",
                text: "Your response",
              },
            },
          ],
        },
      });
      return new Response("OK");
    }

    // Button click: record selected option
    const selectedOption = action.value;
    await recordResponse(
      notification,
      user.id,
      "slack",
      selectedOption,
      selectedOption
    );

    // Update the message to show selection feedback
    if (payload.container) {
      await updateSlackMessage(
        payload.container.channel_id,
        payload.container.message_ts,
        notification.shortCode,
        notification.message,
        selectedOption
      ).catch((err) =>
        console.error("Failed to update Slack message:", err)
      );
    }

    return new Response("OK");
  }

  // Modal submission
  if (payload.type === "view_submission" && payload.view) {
    const callbackId = payload.view.callback_id;

    if (callbackId === "respond_modal") {
      const metadata = JSON.parse(payload.view.private_metadata);
      const notificationId = metadata.notificationId;
      const responseText =
        payload.view.state.values.response_block.response_text.value;

      const [notification] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, notificationId));

      if (!notification) return new Response("OK");

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.slackUserId, payload.user.id));

      if (!user) return new Response("OK");

      await recordResponse(notification, user.id, "slack", responseText);

      // Return empty 200 to close the modal
      return new Response(JSON.stringify({ response_action: "clear" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response("OK");
}

export async function handleSlackEvent(
  payload: SlackEventPayload
): Promise<Response> {
  // URL verification challenge
  if (payload.type === "url_verification") {
    return new Response(JSON.stringify({ challenge: payload.challenge }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (payload.type === "event_callback" && payload.event) {
    const event = payload.event;

    // Ignore bot messages (including our own)
    if (event.bot_id) return new Response("OK");

    // Skip subtypes like message_changed, message_deleted, etc.
    if (event.subtype) return new Response("OK");

    // Thread replies — notification is known from the delivery
    if (event.type === "message" && event.thread_ts) {
      return handleSlackThreadReply(event);
    }

    // Top-level DMs — parse like SMS
    if (event.type === "message" && event.channel_type === "im") {
      return handleSlackDMMessage(event);
    }
  }

  return new Response("OK");
}

async function findNotificationForThreadReply(
  event: NonNullable<SlackEventPayload["event"]>
): Promise<{
  notification: typeof notifications.$inferSelect;
  user: typeof users.$inferSelect;
} | null> {
  // Find user by slack ID
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.slackUserId, event.user));

  if (!user) return null;

  // First try: look up delivery by externalId (reply ts)
  const [delivery] = await db
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.externalId, event.thread_ts!),
        eq(deliveries.channel, "slack")
      )
    );

  if (delivery) {
    const [notification] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, delivery.notificationId));

    if (notification) return { notification, user };
  }

  // Fallback: look up session by slackThreadTs, find most recent notification
  const [session] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.slackThreadTs, event.thread_ts!));

  if (session) {
    const [notification] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.sessionId, session.id),
          eq(notifications.userId, user.id)
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(1);

    if (notification) return { notification, user };
  }

  return null;
}

async function handleSlackThreadReply(
  event: NonNullable<SlackEventPayload["event"]>
): Promise<Response> {
  const result = await findNotificationForThreadReply(event);
  if (!result) return new Response("OK");

  const { notification, user } = result;
  let text = event.text.trim();

  // Append file attachments as URLs
  if (event.files && event.files.length > 0) {
    const fileLines = event.files.map(
      (f) => `[${f.name}](${f.permalink})`
    );
    text = text
      ? `${text}\n${fileLines.join("\n")}`
      : fileLines.join("\n");
  }

  // Support number selection in threads
  const numberMatch = text.match(/^(\d+)$/);
  if (numberMatch) {
    const optionIndex = parseInt(numberMatch[1], 10) - 1;
    if (
      notification.options &&
      optionIndex >= 0 &&
      optionIndex < notification.options.length
    ) {
      const selectedOption = notification.options[optionIndex];
      await recordResponse(
        notification,
        user.id,
        "slack",
        undefined,
        selectedOption
      );
      return new Response("OK");
    }
  }

  // Freeform text — record regardless of notification status
  await recordResponse(notification, user.id, "slack", text);
  return new Response("OK");
}

async function handleSlackDMMessage(
  event: NonNullable<SlackEventPayload["event"]>
): Promise<Response> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.slackUserId, event.user));

  if (!user) {
    await getSlack().chat.postMessage({
      channel: event.channel,
      text: "I don't recognize your Slack account. Please link it in AgentDuty settings.",
    });
    return new Response("OK");
  }

  const result = await parseInboundMessage(event.text.trim(), user.id);

  switch (result.type) {
    case "shortCode":
      await recordResponse(result.notification, user.id, "slack", result.text);
      await getSlack().chat.postMessage({
        channel: event.channel,
        text: `Got it — recorded your response to [${result.notification.shortCode}].`,
      });
      break;
    case "optionSelect":
      await recordResponse(
        result.notification,
        user.id,
        "slack",
        undefined,
        result.selectedOption
      );
      await getSlack().chat.postMessage({
        channel: event.channel,
        text: `Got it — selected *${result.selectedOption}* for [${result.notification.shortCode}].`,
      });
      break;
    case "freeform":
      await recordResponse(result.notification, user.id, "slack", result.text);
      await getSlack().chat.postMessage({
        channel: event.channel,
        text: `Got it — recorded your response to [${result.notification.shortCode}].`,
      });
      break;
    case "invalidOption":
      await getSlack().chat.postMessage({
        channel: event.channel,
        text: "Invalid option number. Please try again.",
      });
      break;
    case "notFound":
      await getSlack().chat.postMessage({
        channel: event.channel,
        text: `No active notification found with code ${result.shortCode}.`,
      });
      break;
    case "noActive":
      await getSlack().chat.postMessage({
        channel: event.channel,
        text: "No active notification to respond to. You can reply with a short code, e.g. `ABC your response`, or reply with a number to select an option.",
      });
      break;
  }

  return new Response("OK");
}
