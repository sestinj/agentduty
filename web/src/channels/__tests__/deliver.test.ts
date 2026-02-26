import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockChain, setupDb, mockSendSlackDM, mockSendSMS } = vi.hoisted(() => {
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

  const mockSendSlackDM = { fn: async (..._args: any[]): Promise<any> => ({ ts: "1234.5678", channel: "D123" }) };
  const mockSendSMS = { fn: async (..._args: any[]): Promise<any> => ({ sid: "SM123" }) };

  return { mockChain: chain, setupDb, mockSendSlackDM, mockSendSMS };
});

vi.mock("@/db", () => ({ db: mockChain }));

vi.mock("@/db/schema", () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_, p) => `${name}.${String(p)}` });
  return {
    notifications: table("notifications"),
    deliveries: table("deliveries"),
    users: table("users"),
    agentSessions: table("agentSessions"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => {},
}));

vi.mock("@/channels/slack", () => ({
  sendSlackDM: (...args: any[]) => mockSendSlackDM.fn(...args),
}));

vi.mock("@/channels/twilio", () => ({
  sendSMS: (...args: any[]) => mockSendSMS.fn(...args),
}));

import { deliverNotification } from "../deliver";

function makeNotification(overrides: Record<string, any> = {}) {
  return {
    id: "notif-1",
    shortCode: "ABC",
    userId: "user-1",
    sessionId: null,
    message: "Test message",
    options: ["Yes", "No"],
    ...overrides,
  };
}

function makeUser(overrides: Record<string, any> = {}) {
  return {
    id: "user-1",
    slackUserId: "U123",
    slackTeamId: "T123",
    phone: "+1234567890",
    ...overrides,
  };
}

describe("deliverNotification", () => {
  beforeEach(() => {
    setupDb();
    mockSendSlackDM.fn = vi.fn().mockResolvedValue({ ts: "1234.5678", channel: "D123" });
    mockSendSMS.fn = vi.fn().mockResolvedValue({ sid: "SM123" });
  });

  it("does nothing if notification not found", async () => {
    setupDb([]);

    await deliverNotification("nonexistent");

    expect(mockSendSlackDM.fn).not.toHaveBeenCalled();
    expect(mockSendSMS.fn).not.toHaveBeenCalled();
  });

  it("does nothing if user not found", async () => {
    setupDb(
      [makeNotification()],
      [],
    );

    await deliverNotification("notif-1");

    expect(mockSendSlackDM.fn).not.toHaveBeenCalled();
    expect(mockSendSMS.fn).not.toHaveBeenCalled();
  });

  it("delivers via Slack when user has slackUserId", async () => {
    setupDb(
      [makeNotification()],
      [makeUser()],
      [],   // insert slack delivery
      [],   // insert sms delivery
      [],   // update notification status
    );

    await deliverNotification("notif-1");

    expect(mockSendSlackDM.fn).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: "U123",
        message: "Test message",
        shortCode: "ABC",
        notificationId: "notif-1",
      }),
    );
  });

  it("delivers via SMS when user has only phone", async () => {
    setupDb(
      [makeNotification()],
      [makeUser({ slackUserId: null })],
      [],   // insert sms delivery
      [],   // update notification status
    );

    await deliverNotification("notif-1");

    expect(mockSendSlackDM.fn).not.toHaveBeenCalled();
    expect(mockSendSMS.fn).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+1234567890",
        message: "Test message",
        shortCode: "ABC",
      }),
    );
  });

  it("falls back to SMS when Slack delivery fails", async () => {
    mockSendSlackDM.fn = vi.fn().mockRejectedValue(new Error("Slack API error"));

    setupDb(
      [makeNotification()],
      [makeUser()],
      [],   // insert failed slack delivery
      [],   // insert sms delivery
      [],   // update notification status
    );

    await deliverNotification("notif-1");

    expect(mockSendSlackDM.fn).toHaveBeenCalled();
    expect(mockSendSMS.fn).toHaveBeenCalled();
  });

  it("routes into existing Slack thread for session notifications", async () => {
    const notification = makeNotification({ sessionId: "session-1" });
    const session = {
      id: "session-1",
      slackThreadTs: "1234.0000",
      slackChannelId: "D123",
    };

    setupDb(
      [notification],
      [makeUser()],
      [session],  // session lookup
      [],         // insert delivery
      [],         // insert sms delivery
      [],         // update notification status
    );

    await deliverNotification("notif-1");

    expect(mockSendSlackDM.fn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadTs: "1234.0000",
      }),
    );
  });

  it("does not update status if no channel succeeds", async () => {
    setupDb(
      [makeNotification()],
      [makeUser({ slackUserId: null, phone: null })],
    );

    await deliverNotification("notif-1");

    expect(mockSendSlackDM.fn).not.toHaveBeenCalled();
    expect(mockSendSMS.fn).not.toHaveBeenCalled();
  });
});
