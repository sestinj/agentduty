import { db } from "@/db";
import { notifications, responses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";

export async function recordResponse(
  notification: typeof notifications.$inferSelect,
  responderId: string,
  channel: "slack" | "sms",
  text?: string,
  selectedOption?: string,
  externalId?: string
) {
  await db.insert(responses).values({
    notificationId: notification.id,
    channel,
    text: text ?? null,
    selectedOption: selectedOption ?? null,
    externalId: externalId ?? null,
    responderId,
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
