import { WebClient } from "@slack/web-api";
import { db } from "@/db";
import {
  notifications,
  responses,
  deliveries,
  users,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { inngest } from "@/inngest/client";

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
    ts: string;
    bot_id?: string;
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
    await recordSlackResponse(notification, user, selectedOption, selectedOption);
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

      await recordSlackResponse(notification, user, responseText);

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

    // Thread replies are responses to notifications
    if (event.type === "message" && event.thread_ts) {
      // Find delivery by thread_ts (external_id)
      const [delivery] = await db
        .select()
        .from(deliveries)
        .where(
          and(
            eq(deliveries.externalId, event.thread_ts),
            eq(deliveries.channel, "slack")
          )
        );

      if (!delivery) return new Response("OK");

      const [notification] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, delivery.notificationId));

      if (!notification) return new Response("OK");

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.slackUserId, event.user));

      if (!user) return new Response("OK");

      await recordSlackResponse(notification, user, event.text);
    }
  }

  return new Response("OK");
}

async function recordSlackResponse(
  notification: typeof notifications.$inferSelect,
  user: typeof users.$inferSelect,
  text?: string,
  selectedOption?: string
) {
  await db.insert(responses).values({
    notificationId: notification.id,
    channel: "slack",
    text: text ?? null,
    selectedOption: selectedOption ?? null,
    responderId: user.id,
  });

  await db
    .update(notifications)
    .set({ status: "responded", updatedAt: new Date() })
    .where(eq(notifications.id, notification.id));

  // Cancel escalation via Inngest (non-blocking)
  inngest
    .send({
      name: "notification/responded",
      data: { notificationId: notification.id },
    })
    .catch(() => {});
}
