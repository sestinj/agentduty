import builder from "./builder";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createApiKey, revokeApiKey } from "@/auth/api-keys";

const ApiKeyType = builder.objectRef<{
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}>("ApiKey");

ApiKeyType.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    name: t.exposeString("name"),
    keyPrefix: t.exposeString("keyPrefix"),
    lastUsedAt: t.string({
      nullable: true,
      resolve: (k) => k.lastUsedAt?.toISOString() ?? null,
    }),
    expiresAt: t.string({
      nullable: true,
      resolve: (k) => k.expiresAt?.toISOString() ?? null,
    }),
    createdAt: t.string({
      resolve: (k) => k.createdAt.toISOString(),
    }),
  }),
});

const CreateApiKeyResult = builder.objectRef<{
  key: string;
  id: string;
  prefix: string;
}>("CreateApiKeyResult");

CreateApiKeyResult.implement({
  fields: (t) => ({
    key: t.exposeString("key"),
    id: t.exposeString("id"),
    prefix: t.exposeString("prefix"),
  }),
});

builder.queryField("apiKeys", (t) =>
  t.field({
    type: [ApiKeyType],
    resolve: async (_parent, _args, ctx) => {
      if (!ctx.userId) throw new Error("Unauthorized");
      return db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.userId, ctx.userId));
    },
  })
);

builder.mutationField("createApiKey", (t) =>
  t.field({
    type: CreateApiKeyResult,
    args: {
      name: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, ctx) => {
      if (!ctx.userId) throw new Error("Unauthorized");
      return createApiKey(ctx.userId, args.name);
    },
  })
);

builder.mutationField("revokeApiKey", (t) =>
  t.field({
    type: "Boolean",
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, ctx) => {
      if (!ctx.userId) throw new Error("Unauthorized");
      return revokeApiKey(ctx.userId, args.id);
    },
  })
);
