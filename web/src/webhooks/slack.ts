import { db } from "@/db";
import {
  notifications,
  responses,
  deliveries,
  users,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { inngest } from "@/inngest/client";

interface SlackInteractionPayload {
  type: string;
  user: { id: string };
  actions?: Array<{
    action_id: string;
    value: string;
  }>;
  view?: {
    callback_id: string;
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

    if (optionIndex === "other") {
      // TODO: Open modal for custom response. For now, just record empty.
      return new Response("OK");
    }

    const selectedOption = action.value;

    await db.insert(responses).values({
      notificationId: notification.id,
      channel: "slack",
      selectedOption,
      responderId: user.id,
    });

    await db
      .update(notifications)
      .set({ status: "responded", updatedAt: new Date() })
      .where(eq(notifications.id, notification.id));

    await inngest.send({
      name: "notification/responded",
      data: { notificationId: notification.id },
    });
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

      await db.insert(responses).values({
        notificationId: notification.id,
        channel: "slack",
        text: event.text,
        responderId: user.id,
      });

      await db
        .update(notifications)
        .set({ status: "responded", updatedAt: new Date() })
        .where(eq(notifications.id, notification.id));

      await inngest.send({
        name: "notification/responded",
        data: { notificationId: notification.id },
      });
    }
  }

  return new Response("OK");
}
