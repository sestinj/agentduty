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
    notifications: table("notifications"),
    responses: table("responses"),
    deliveries: table("deliveries"),
    agentSessions: table("agentSessions"),
    escalationPolicies: table("escalationPolicies"),
    priorityRoutes: table("priorityRoutes"),
    users: table("users"),
    apiKeys: table("apiKeys"),
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

// Use executeGraphQL to avoid graphql module duplication issues in Vite
import { executeGraphQL } from "@/schema/execute";

function makeNotification(overrides: Record<string, any> = {}) {
  return {
    id: "notif-1",
    shortCode: "ABC",
    userId: "user-1",
    sessionId: null,
    message: "Test notification",
    priority: 3,
    context: null,
    tags: [],
    options: ["Yes", "No"],
    status: "pending",
    currentEscalationStep: null,
    policyId: null,
    snoozedUntil: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("createNotification", () => {
  beforeEach(() => {
    setupDb();
  });

  it("requires authentication", async () => {
    const result = await executeGraphQL(
      `mutation { createNotification(message: "test") { id } }`,
      { userId: null },
    );

    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toBe("Unauthorized");
  });

  it("creates a notification with required fields", async () => {
    const created = makeNotification({ status: "pending" });
    const delivered = makeNotification({ status: "delivered" });

    setupDb(
      [],         // priorityRoutes lookup
      [],         // default escalation policy lookup
      [created],  // insert notification returning
      [delivered], // re-fetch after delivery
    );

    const result = await executeGraphQL(
      `mutation {
        createNotification(message: "Hello", priority: 4, options: ["Yes", "No"]) {
          id message status
        }
      }`,
      { userId: "user-1" },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.createNotification).toMatchObject({
      id: "notif-1",
      message: "Test notification",
      status: "delivered",
    });
  });

  it("creates a session when sessionKey is provided", async () => {
    const created = makeNotification({ sessionId: "session-1" });

    setupDb(
      [],                     // session lookup (not found)
      [{ id: "session-1" }], // insert session returning
      [],                     // priorityRoutes lookup
      [],                     // default escalation policy lookup
      [created],              // insert notification returning
      [created],              // re-fetch
    );

    const result = await executeGraphQL(
      `mutation {
        createNotification(message: "Hello", sessionKey: "my-session") { id }
      }`,
      { userId: "user-1" },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.createNotification.id).toBe("notif-1");
  });
});

describe("respondToNotification", () => {
  beforeEach(() => {
    setupDb();
  });

  it("requires authentication", async () => {
    const result = await executeGraphQL(
      `mutation { respondToNotification(id: "notif-1", text: "yes") { id } }`,
      { userId: null },
    );

    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toBe("Unauthorized");
  });

  it("records response and updates status to responded", async () => {
    const notification = makeNotification();
    const updated = makeNotification({ status: "responded" });

    setupDb(
      [notification], // findNotificationByIdOrShortCode
      [],             // insert response
      [updated],      // update notification returning
    );

    const result = await executeGraphQL(
      `mutation {
        respondToNotification(id: "notif-1", text: "Looks good!") {
          id status
        }
      }`,
      { userId: "user-1" },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.respondToNotification).toMatchObject({
      id: "notif-1",
      status: "responded",
    });
  });

  it("returns null for nonexistent notification", async () => {
    setupDb([]);

    const result = await executeGraphQL(
      `mutation {
        respondToNotification(id: "nonexistent", text: "hi") { id }
      }`,
      { userId: "user-1" },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.respondToNotification).toBeNull();
  });
});

describe("archiveNotification", () => {
  beforeEach(() => {
    setupDb();
  });

  it("archives a notification by ID", async () => {
    const notification = makeNotification();
    const archived = makeNotification({ status: "archived" });

    setupDb(
      [notification],
      [archived],
    );

    const result = await executeGraphQL(
      `mutation { archiveNotification(id: "notif-1") { id status } }`,
      { userId: "user-1" },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.archiveNotification).toMatchObject({
      id: "notif-1",
      status: "archived",
    });
  });

  it("returns null for nonexistent notification", async () => {
    setupDb([]);

    const result = await executeGraphQL(
      `mutation { archiveNotification(id: "gone") { id } }`,
      { userId: "user-1" },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.archiveNotification).toBeNull();
  });
});

describe("archiveAllNotifications", () => {
  beforeEach(() => {
    setupDb();
  });

  it("returns count of archived notifications", async () => {
    setupDb([{ id: "a" }, { id: "b" }, { id: "c" }]);

    const result = await executeGraphQL(
      `mutation { archiveAllNotifications }`,
      { userId: "user-1" },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.archiveAllNotifications).toBe(3);
  });

  it("requires authentication", async () => {
    const result = await executeGraphQL(
      `mutation { archiveAllNotifications }`,
      { userId: null },
    );

    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toBe("Unauthorized");
  });
});

describe("activeFeed", () => {
  beforeEach(() => {
    setupDb();
  });

  it("returns pending/delivered notifications", async () => {
    const pending = makeNotification({ id: "n1", status: "pending" });
    const delivered = makeNotification({ id: "n2", status: "delivered" });

    setupDb([pending, delivered]);

    const result = await executeGraphQL(
      `query { activeFeed { id status } }`,
      { userId: "user-1" },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.activeFeed).toHaveLength(2);
  });

  it("requires authentication", async () => {
    const result = await executeGraphQL(
      `query { activeFeed { id } }`,
      { userId: null },
    );

    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toBe("Unauthorized");
  });
});

describe("snoozeNotification", () => {
  beforeEach(() => {
    setupDb();
  });

  it("sets snoozedUntil on the notification", async () => {
    const notification = makeNotification();
    const snoozed = makeNotification({
      snoozedUntil: new Date(Date.now() + 15 * 60_000),
    });

    setupDb(
      [notification],
      [snoozed],
    );

    const result = await executeGraphQL(
      `mutation {
        snoozeNotification(id: "notif-1", minutes: 15) {
          id snoozedUntil
        }
      }`,
      { userId: "user-1" },
    );

    expect(result.errors).toBeUndefined();
    expect(result.data?.snoozeNotification.snoozedUntil).toBeTruthy();
  });
});
