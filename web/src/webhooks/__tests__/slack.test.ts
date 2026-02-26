import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockChain, setupDb, mockSlackPost, mockSlackUpdate, mockSlackViewsOpen, mockRecordResponse, mockParseInbound } = vi.hoisted(() => {
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

  const mockSlackPost = { fn: async (..._args: any[]) => ({ ok: true }) };
  const mockSlackUpdate = { fn: async (..._args: any[]) => ({ ok: true }) };
  const mockSlackViewsOpen = { fn: async (..._args: any[]) => ({ ok: true }) };
  const mockRecordResponse = { fn: async (..._args: any[]) => {} };
  const mockParseInbound = { fn: async (..._args: any[]): Promise<any> => ({ type: "noActive" }) };

  return { mockChain: chain, setupDb, mockSlackPost, mockSlackUpdate, mockSlackViewsOpen, mockRecordResponse, mockParseInbound };
});

vi.mock("@/db", () => ({ db: mockChain }));

vi.mock("@/db/schema", () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_, p) => `${name}.${String(p)}` });
  return {
    notifications: table("notifications"),
    responses: table("responses"),
    deliveries: table("deliveries"),
    users: table("users"),
    agentSessions: table("agentSessions"),
    slackInstallations: table("slackInstallations"),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => {},
  and: () => {},
  or: () => {},
  desc: () => {},
  asc: () => {},
  gt: () => {},
}));

vi.mock("@slack/web-api", () => ({
  WebClient: class {
    chat = {
      postMessage: (...args: any[]) => mockSlackPost.fn(...args),
      update: (...args: any[]) => mockSlackUpdate.fn(...args),
    };
    views = {
      open: (...args: any[]) => mockSlackViewsOpen.fn(...args),
    };
    reactions = {
      add: async () => ({ ok: true }),
    };
  },
}));

vi.mock("@/channels/slack", () => ({
  updateSlackMessage: () => Promise.resolve(),
  getSlackForTeam: () => Promise.resolve({}),
}));

vi.mock("@/webhooks/record-response", () => ({
  recordResponse: (...args: any[]) => mockRecordResponse.fn(...args),
}));

vi.mock("@/webhooks/parse-inbound", () => ({
  parseInboundMessage: (...args: any[]) => mockParseInbound.fn(...args),
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send: () => Promise.resolve() },
}));

import { handleSlackInteraction, handleSlackEvent } from "../slack";

describe("handleSlackEvent", () => {
  beforeEach(() => {
    setupDb();
    mockRecordResponse.fn = vi.fn().mockResolvedValue(undefined);
    mockSlackPost.fn = vi.fn().mockResolvedValue({ ok: true });
  });

  it("responds to URL verification challenge", async () => {
    const response = await handleSlackEvent({
      type: "url_verification",
      challenge: "test-challenge-token",
    });

    const body = await response.json();
    expect(body.challenge).toBe("test-challenge-token");
  });

  it("ignores bot messages", async () => {
    const response = await handleSlackEvent({
      type: "event_callback",
      event: {
        type: "message",
        user: "U123",
        text: "Hello",
        channel: "D123",
        channel_type: "im",
        ts: "1234567890.123456",
        bot_id: "B123",
      },
    });

    expect(response.status).toBe(200);
    expect(mockRecordResponse.fn).not.toHaveBeenCalled();
  });

  it("handles thread replies by looking up delivery", async () => {
    const notification = {
      id: "notif-1",
      shortCode: "ABC",
      message: "test",
      options: null,
      userId: "user-1",
    };
    const user = { id: "user-1", slackUserId: "U123" };

    setupDb(
      [user],                            // find user by slackUserId
      [{ notificationId: "notif-1" }],   // delivery lookup by thread_ts
      [notification],                     // notification lookup
    );

    const response = await handleSlackEvent({
      type: "event_callback",
      event: {
        type: "message",
        user: "U123",
        text: "Looks good!",
        thread_ts: "1234567890.000000",
        channel: "D123",
        ts: "1234567891.000000",
      },
    });

    expect(response.status).toBe(200);
    expect(mockRecordResponse.fn).toHaveBeenCalledWith(
      notification,
      "user-1",
      "slack",
      "Looks good!",
      undefined,
      "1234567891.000000",
    );
  });

  it("handles numeric option selection in thread replies", async () => {
    const notification = {
      id: "notif-1",
      shortCode: "ABC",
      message: "Choose one",
      options: ["Yes", "No"],
      userId: "user-1",
    };
    const user = { id: "user-1", slackUserId: "U123" };

    setupDb(
      [user],
      [{ notificationId: "notif-1" }],
      [notification],
    );

    const response = await handleSlackEvent({
      type: "event_callback",
      event: {
        type: "message",
        user: "U123",
        text: "1",
        thread_ts: "1234567890.000000",
        channel: "D123",
        ts: "1234567891.000000",
      },
    });

    expect(response.status).toBe(200);
    expect(mockRecordResponse.fn).toHaveBeenCalledWith(
      notification,
      "user-1",
      "slack",
      undefined,
      "Yes",
      "1234567891.000000",
    );
  });

  it("handles unrecognized Slack user in DM", async () => {
    setupDb([]); // user not found

    const response = await handleSlackEvent({
      type: "event_callback",
      event: {
        type: "message",
        user: "UUNKNOWN",
        text: "hello",
        channel: "D999",
        channel_type: "im",
        ts: "1234567890.123456",
      },
    });

    expect(response.status).toBe(200);
    expect(mockSlackPost.fn).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "D999",
        text: expect.stringContaining("don't recognize"),
      }),
    );
  });

  it("handles DM messages with short code response", async () => {
    const notification = { id: "notif-1", shortCode: "XYZ" };
    const user = { id: "user-1", slackUserId: "U123" };

    mockParseInbound.fn = vi.fn().mockResolvedValue({
      type: "shortCode",
      notification,
      text: "my response",
    });

    setupDb([user]);

    const response = await handleSlackEvent({
      type: "event_callback",
      event: {
        type: "message",
        user: "U123",
        text: "XYZ my response",
        channel: "D123",
        channel_type: "im",
        ts: "1234567890.123456",
      },
    });

    expect(response.status).toBe(200);
    expect(mockRecordResponse.fn).toHaveBeenCalled();
  });
});

describe("handleSlackInteraction", () => {
  beforeEach(() => {
    setupDb();
    mockRecordResponse.fn = vi.fn().mockResolvedValue(undefined);
    mockSlackViewsOpen.fn = vi.fn().mockResolvedValue({ ok: true });
  });

  it("handles button click with option selection", async () => {
    const notification = {
      id: "notif-1",
      shortCode: "ABC",
      message: "Choose",
      options: ["Yes", "No"],
    };
    const user = { id: "user-1", slackUserId: "U123" };

    setupDb(
      [notification],
      [user],
    );

    const response = await handleSlackInteraction({
      type: "block_actions",
      user: { id: "U123" },
      actions: [
        {
          action_id: "respond_notif-1_0",
          value: "Yes",
        },
      ],
      container: {
        message_ts: "1234567890.000000",
        channel_id: "C123",
      },
    });

    expect(response.status).toBe(200);
    expect(mockRecordResponse.fn).toHaveBeenCalledWith(
      notification,
      "user-1",
      "slack",
      "Yes",
      "Yes",
    );
  });

  it("opens modal for 'Other...' button click", async () => {
    const notification = {
      id: "notif-1",
      shortCode: "ABC",
      message: "Choose",
      options: ["Yes", "No"],
    };
    const user = { id: "user-1", slackUserId: "U123" };

    setupDb([notification], [user]);

    const response = await handleSlackInteraction({
      type: "block_actions",
      user: { id: "U123" },
      actions: [
        {
          action_id: "respond_notif-1_other",
          value: "__other__",
        },
      ],
      container: {
        message_ts: "1234567890.000000",
        channel_id: "C123",
      },
      trigger_id: "trigger-123",
    });

    expect(response.status).toBe(200);
    expect(mockSlackViewsOpen.fn).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger_id: "trigger-123",
      }),
    );
  });

  it("handles modal submission with custom response", async () => {
    const notification = {
      id: "notif-1",
      shortCode: "ABC",
      message: "Choose",
    };
    const user = { id: "user-1", slackUserId: "U123" };

    setupDb(
      [notification],
      [user],
    );

    const response = await handleSlackInteraction({
      type: "view_submission",
      user: { id: "U123" },
      view: {
        callback_id: "respond_modal",
        private_metadata: JSON.stringify({
          notificationId: "notif-1",
          shortCode: "ABC",
          message: "Choose",
          channelId: "C123",
          messageTs: "1234567890.000000",
        }),
        state: {
          values: {
            response_block: {
              response_text: {
                value: "My custom response",
              },
            },
          },
        },
      },
    });

    const body = await response.json();
    expect(body.response_action).toBe("clear");
    expect(mockRecordResponse.fn).toHaveBeenCalledWith(
      notification,
      "user-1",
      "slack",
      "My custom response",
    );
  });

  it("returns OK for unknown action_id format", async () => {
    const response = await handleSlackInteraction({
      type: "block_actions",
      user: { id: "U123" },
      actions: [
        {
          action_id: "unknown_action",
          value: "x",
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(mockRecordResponse.fn).not.toHaveBeenCalled();
  });
});
