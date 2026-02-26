import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockChain, setupDb } = vi.hoisted(() => {
  let dbResults: any[][] = [];
  let dbCallIndex = 0;

  const chain: any = {};
  const methods = [
    "select", "from", "where", "update", "set", "insert",
    "values", "delete", "returning", "orderBy", "limit",
  ];
  for (const m of methods) {
    chain[m] = (..._args: any[]) => chain;
  }
  chain.then = (resolve: any, reject?: any) => {
    const result = dbResults[dbCallIndex] ?? [];
    dbCallIndex++;
    return Promise.resolve(result).then(resolve, reject);
  };

  function setupDb(...results: any[][]) {
    dbResults = results;
    dbCallIndex = 0;
  }

  return { mockChain: chain, setupDb };
});

vi.mock("@/db", () => ({ db: mockChain }));

vi.mock("@/db/schema", () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_, p) => `${name}.${String(p)}` });
  return {
    apiKeys: table("apiKeys"),
    users: table("users"),
    notifications: table("notifications"),
    responses: table("responses"),
    deliveries: table("deliveries"),
    agentSessions: table("agentSessions"),
    escalationPolicies: table("escalationPolicies"),
    priorityRoutes: table("priorityRoutes"),
    slackInstallations: table("slackInstallations"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => {},
  and: () => {},
  or: () => {},
  desc: () => {},
  asc: () => {},
  inArray: () => {},
  isNull: () => {},
  lte: () => {},
  gt: () => {},
  sql: () => {},
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send: () => Promise.resolve() },
}));

vi.mock("@/channels/deliver", () => ({
  deliverNotification: () => Promise.resolve(),
}));

vi.mock("@/channels/slack", () => ({
  sendSlackDM: () => Promise.resolve({ ts: "ts-1", channel: "C123" }),
  updateSlackMessage: () => Promise.resolve(),
  addSlackReaction: () => Promise.resolve(),
  getSlackForTeam: () => Promise.resolve({}),
}));

vi.mock("@/channels/twilio", () => ({
  sendSMS: () => Promise.resolve({ sid: "SM123" }),
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: () => () => {},
  jwtVerify: async () => ({ payload: {} }),
}));

vi.mock("@/auth/workos", () => ({
  workos: { userManagement: { getUser: async () => ({}) } },
  WORKOS_CLIENT_ID: "test_client_id",
}));

import { executeGraphQL } from "@/schema/execute";

describe("apiKeys query", () => {
  beforeEach(() => {
    setupDb();
  });

  it("requires authentication", async () => {
    const result = await executeGraphQL(
      `query { apiKeys { id } }`,
      { userId: null },
    );
    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toBe("Unauthorized");
  });

  it("returns user api keys", async () => {
    setupDb([
      {
        id: "key-1",
        name: "Dev Key",
        keyPrefix: "adk_live_sk_",
        lastUsedAt: null,
        expiresAt: null,
        createdAt: new Date("2025-01-01"),
      },
    ]);

    const result = await executeGraphQL(
      `query {
        apiKeys { id name keyPrefix createdAt }
      }`,
      { userId: "user-1" },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.apiKeys).toHaveLength(1);
    expect(result.data?.apiKeys[0].name).toBe("Dev Key");
  });
});

describe("createApiKey mutation", () => {
  beforeEach(() => {
    setupDb();
  });

  it("requires authentication", async () => {
    const result = await executeGraphQL(
      `mutation { createApiKey(name: "test") { key id prefix } }`,
      { userId: null },
    );
    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toBe("Unauthorized");
  });

  it("creates and returns a new API key", async () => {
    setupDb([{ id: "new-key-id" }]);

    const result = await executeGraphQL(
      `mutation { createApiKey(name: "CI Key") { key id prefix } }`,
      { userId: "user-1" },
    );

    expect(result.errors).toBeUndefined();
    const data = result.data?.createApiKey;
    expect(data.id).toBe("new-key-id");
    expect(data.key).toMatch(/^adk_live_sk_/);
    expect(data.prefix).toBe("adk_live_sk_");
  });
});

describe("revokeApiKey mutation", () => {
  beforeEach(() => {
    setupDb();
  });

  it("requires authentication", async () => {
    const result = await executeGraphQL(
      `mutation { revokeApiKey(id: "key-1") }`,
      { userId: null },
    );
    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toBe("Unauthorized");
  });

  it("returns true when key is revoked", async () => {
    setupDb([{ id: "key-1" }]);

    const result = await executeGraphQL(
      `mutation { revokeApiKey(id: "key-1") }`,
      { userId: "user-1" },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.revokeApiKey).toBe(true);
  });

  it("returns false when key not found", async () => {
    setupDb([]);

    const result = await executeGraphQL(
      `mutation { revokeApiKey(id: "nonexistent") }`,
      { userId: "user-1" },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.revokeApiKey).toBe(false);
  });
});
