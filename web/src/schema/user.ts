import crypto from "crypto";
import builder from "./builder";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

const UserType = builder.objectRef<{
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  slackUserId: string | null;
  slackTeamId: string | null;
  timezone: string | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  createdAt: Date;
}>("User");

UserType.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    email: t.exposeString("email"),
    name: t.exposeString("name", { nullable: true }),
    phone: t.exposeString("phone", { nullable: true }),
    slackUserId: t.exposeString("slackUserId", { nullable: true }),
    slackTeamId: t.exposeString("slackTeamId", { nullable: true }),
    timezone: t.exposeString("timezone", { nullable: true }),
    quietHoursStart: t.exposeString("quietHoursStart", { nullable: true }),
    quietHoursEnd: t.exposeString("quietHoursEnd", { nullable: true }),
    createdAt: t.string({
      resolve: (user) => user.createdAt.toISOString(),
    }),
  }),
});

builder.queryField("me", (t) =>
  t.field({
    type: UserType,
    nullable: true,
    resolve: async (_parent, _args, ctx) => {
      if (!ctx.userId) return null;
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.userId));
      return user ?? null;
    },
  })
);

builder.mutationField("generateSlackLinkCode", (t) =>
  t.field({
    type: "String",
    resolve: async (_parent, _args, ctx) => {
      if (!ctx.userId) throw new Error("Unauthorized");

      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
      const bytes = crypto.randomBytes(6);
      let code = "LINK-";
      for (let i = 0; i < 6; i++) {
        code += chars[bytes[i] % chars.length];
      }

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await db
        .update(users)
        .set({
          slackLinkCode: code,
          slackLinkCodeExpiresAt: expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.userId));

      return code;
    },
  })
);

builder.queryField("slackConnected", (t) =>
  t.field({
    type: "Boolean",
    resolve: async (_parent, _args, ctx) => {
      if (!ctx.userId) throw new Error("Unauthorized");
      const [user] = await db
        .select({ slackUserId: users.slackUserId })
        .from(users)
        .where(eq(users.id, ctx.userId));
      return !!user?.slackUserId;
    },
  })
);

export { UserType };
