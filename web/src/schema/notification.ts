import crypto from "crypto";
import builder from "./builder";
import { db } from "@/db";
import {
  notifications,
  responses,
  agentSessions,
  escalationPolicies,
  priorityRoutes,
} from "@/db/schema";
import { eq, and, or, desc } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { ResponseType } from "./response";
import { deliverNotification } from "@/channels/deliver";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findNotificationByIdOrShortCode(id: string, userId: string) {
  const idFilter = UUID_RE.test(id)
    ? eq(notifications.id, id)
    : eq(notifications.shortCode, id);

  return db
    .select()
    .from(notifications)
    .where(and(idFilter, eq(notifications.userId, userId)));
}

function generateShortCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(3);
  let code = "";
  for (let i = 0; i < 3; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

const NotificationType = builder.objectRef<{
  id: string;
  shortCode: string;
  userId: string;
  sessionId: string | null;
  message: string;
  priority: number;
  context: unknown;
  tags: string[] | null;
  options: string[] | null;
  status: string;
  currentEscalationStep: number | null;
  policyId: string | null;
  createdAt: Date;
  updatedAt: Date;
}>("Notification");

NotificationType.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    shortCode: t.exposeString("shortCode"),
    userId: t.exposeString("userId"),
    sessionId: t.exposeString("sessionId", { nullable: true }),
    message: t.exposeString("message"),
    priority: t.exposeInt("priority"),
    context: t.string({
      nullable: true,
      resolve: (n) => (n.context ? JSON.stringify(n.context) : null),
    }),
    tags: t.exposeStringList("tags", { nullable: true }),
    options: t.exposeStringList("options", { nullable: true }),
    status: t.exposeString("status"),
    currentEscalationStep: t.exposeInt("currentEscalationStep", {
      nullable: true,
    }),
    policyId: t.exposeString("policyId", { nullable: true }),
    createdAt: t.string({
      resolve: (n) => n.createdAt.toISOString(),
    }),
    updatedAt: t.string({
      resolve: (n) => n.updatedAt.toISOString(),
    }),
    responses: t.field({
      type: [ResponseType],
      resolve: async (notification) => {
        return db
          .select()
          .from(responses)
          .where(eq(responses.notificationId, notification.id));
      },
    }),
  }),
});

builder.queryField("notification", (t) =>
  t.field({
    type: NotificationType,
    nullable: true,
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, ctx) => {
      if (!ctx.userId) throw new Error("Unauthorized");
      const [notification] = await findNotificationByIdOrShortCode(
        args.id,
        ctx.userId
      );
      return notification ?? null;
    },
  })
);

builder.queryField("notifications", (t) =>
  t.field({
    type: [NotificationType],
    args: {
      status: t.arg.string({ required: false }),
    },
    resolve: async (_parent, args, ctx) => {
      if (!ctx.userId) throw new Error("Unauthorized");
      const conditions = [eq(notifications.userId, ctx.userId)];

      if (args.status) {
        conditions.push(
          eq(
            notifications.status,
            args.status as
              | "pending"
              | "delivered"
              | "responded"
              | "expired"
          )
        );
      }

      return db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt));
    },
  })
);

builder.mutationField("createNotification", (t) =>
  t.field({
    type: NotificationType,
    args: {
      message: t.arg.string({ required: true }),
      priority: t.arg.int({ required: false }),
      options: t.arg.stringList({ required: false }),
      context: t.arg.string({ required: false }),
      tags: t.arg.stringList({ required: false }),
      sessionKey: t.arg.string({ required: false }),
      workspace: t.arg.string({ required: false }),
    },
    resolve: async (_parent, args, ctx) => {
      if (!ctx.userId) throw new Error("Unauthorized");

      const priority = args.priority ?? 3;
      const shortCode = generateShortCode();

      // Find or create session if sessionKey provided
      let sessionId: string | null = null;
      if (args.sessionKey) {
        const [existing] = await db
          .select()
          .from(agentSessions)
          .where(
            and(
              eq(agentSessions.sessionKey, args.sessionKey),
              eq(agentSessions.userId, ctx.userId)
            )
          );

        if (existing) {
          sessionId = existing.id;
        } else {
          const [session] = await db
            .insert(agentSessions)
            .values({
              userId: ctx.userId,
              sessionKey: args.sessionKey,
              workspace: args.workspace,
            })
            .returning({ id: agentSessions.id });
          sessionId = session.id;
        }
      }

      // Find escalation policy based on priority
      let policyId: string | null = null;
      const [route] = await db
        .select()
        .from(priorityRoutes)
        .where(
          and(
            eq(priorityRoutes.userId, ctx.userId),
            eq(priorityRoutes.priority, priority)
          )
        );

      if (route) {
        policyId = route.policyId;
      } else {
        // Fall back to default policy
        const [defaultPolicy] = await db
          .select()
          .from(escalationPolicies)
          .where(
            and(
              eq(escalationPolicies.userId, ctx.userId),
              eq(escalationPolicies.isDefault, true)
            )
          );
        if (defaultPolicy) {
          policyId = defaultPolicy.id;
        }
      }

      const [notification] = await db
        .insert(notifications)
        .values({
          shortCode,
          userId: ctx.userId,
          sessionId,
          message: args.message,
          priority,
          context: args.context ? JSON.parse(args.context) : null,
          tags: args.tags ?? [],
          options: args.options ?? [],
          status: "pending",
          policyId,
        })
        .returning();

      // Deliver to Slack/SMS and update status.
      await deliverNotification(notification.id);

      // Trigger Inngest for multi-step escalation if configured.
      inngest
        .send({
          name: "notification/created",
          data: { notificationId: notification.id },
        })
        .catch(() => {});

      // Re-fetch to return updated status/channels.
      const [updated] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, notification.id));

      return updated ?? notification;
    },
  })
);

builder.mutationField("respondToNotification", (t) =>
  t.field({
    type: NotificationType,
    nullable: true,
    args: {
      id: t.arg.string({ required: true }),
      text: t.arg.string({ required: false }),
      selectedOption: t.arg.string({ required: false }),
    },
    resolve: async (_parent, args, ctx) => {
      if (!ctx.userId) throw new Error("Unauthorized");

      const [notification] = await findNotificationByIdOrShortCode(
        args.id,
        ctx.userId
      );

      if (!notification) return null;

      // Record the response
      await db.insert(responses).values({
        notificationId: notification.id,
        channel: "slack",
        text: args.text,
        selectedOption: args.selectedOption,
        responderId: ctx.userId,
      });

      // Update notification status
      const [updated] = await db
        .update(notifications)
        .set({ status: "responded", updatedAt: new Date() })
        .where(eq(notifications.id, notification.id))
        .returning();

      // Cancel escalation via Inngest (non-blocking)
      inngest
        .send({
          name: "notification/responded",
          data: {
            notificationId: notification.id,
          },
        })
        .catch((err: unknown) => {
          console.warn("Inngest send failed (cancellation skipped):", err);
        });

      return updated;
    },
  })
);

export { NotificationType };
