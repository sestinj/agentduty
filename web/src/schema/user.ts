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

export { UserType };
