import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// --- Hoisted mock DB (vi.mock is hoisted, so variables must be too) ---
const { mockChain, setupDb } = vi.hoisted(() => {
  let dbResults: any[][] = [];
  let dbCallIndex = 0;

  const chainMethods = [
    "select", "from", "where", "update", "set", "insert",
    "values", "delete", "returning", "orderBy", "limit",
  ];

  const chain: any = {};
  for (const method of chainMethods) {
    chain[method] = (..._args: any[]) => chain;
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
  };
});

vi.mock("drizzle-orm", () => ({
  eq: () => {},
  and: () => {},
}));

vi.mock("jose", () => ({
  createRemoteJWKSet: () => () => {},
  jwtVerify: async () => ({ payload: {} }),
}));

vi.mock("@/auth/workos", () => ({
  workos: { userManagement: { getUser: async () => ({}) } },
  WORKOS_CLIENT_ID: "test_client_id",
}));

import { authenticateRequest, createApiKey, revokeApiKey } from "../api-keys";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function makeKeyRecord(rawKey: string, userId: string, overrides: Record<string, any> = {}) {
  return {
    id: `key-${userId}`,
    userId,
    keyHash: hashKey(rawKey),
    keyPrefix: rawKey.slice(0, 12),
    expiresAt: null,
    ...overrides,
  };
}

describe("authenticateRequest", () => {
  beforeEach(() => {
    setupDb();
  });

  it("returns null when no authorization header is present", async () => {
    const request = new Request("http://localhost", { headers: {} });
    expect(await authenticateRequest(request)).toBeNull();
  });

  it("returns null for unrecognized auth scheme", async () => {
    const request = new Request("http://localhost", {
      headers: { authorization: "Basic abc123" },
    });
    expect(await authenticateRequest(request)).toBeNull();
  });

  it("authenticates a valid API key sent directly", async () => {
    const rawKey = "adk_live_sk_testkey12345678";
    const record = makeKeyRecord(rawKey, "user-1");
    setupDb([record], []); // select, then fire-and-forget update

    const request = new Request("http://localhost", {
      headers: { authorization: rawKey },
    });
    expect(await authenticateRequest(request)).toEqual({ userId: "user-1" });
  });

  it("authenticates API key sent as Bearer token", async () => {
    const rawKey = "adk_live_sk_bearerkey12345";
    const record = makeKeyRecord(rawKey, "user-bearer");
    setupDb([record], []);

    const request = new Request("http://localhost", {
      headers: { authorization: `Bearer ${rawKey}` },
    });
    expect(await authenticateRequest(request)).toEqual({ userId: "user-bearer" });
  });

  it("rejects an expired API key", async () => {
    const rawKey = "adk_live_sk_expiredkey12345";
    const record = makeKeyRecord(rawKey, "user-expired", {
      expiresAt: new Date(Date.now() - 60_000),
    });
    setupDb([record]);

    const request = new Request("http://localhost", {
      headers: { authorization: rawKey },
    });
    expect(await authenticateRequest(request)).toBeNull();
  });

  it("rejects a key with wrong hash", async () => {
    const rawKey = "adk_live_sk_wronghash12345";
    const record = makeKeyRecord(rawKey, "user-wrong", {
      keyHash: hashKey("adk_live_sk_completely_different"),
    });
    setupDb([record]);

    const request = new Request("http://localhost", {
      headers: { authorization: rawKey },
    });
    expect(await authenticateRequest(request)).toBeNull();
  });

  it("finds correct key among multiple with same prefix", async () => {
    const rawKey = "adk_live_sk_multikey123456";
    const wrongRecord = makeKeyRecord(rawKey, "user-wrong", {
      id: "key-wrong",
      keyHash: hashKey("adk_live_sk_different_key_1"),
    });
    const correctRecord = makeKeyRecord(rawKey, "user-correct", {
      id: "key-correct",
    });
    setupDb([wrongRecord, correctRecord], []);

    const request = new Request("http://localhost", {
      headers: { authorization: rawKey },
    });
    expect(await authenticateRequest(request)).toEqual({ userId: "user-correct" });
  });

  it("returns null when no keys match the prefix", async () => {
    setupDb([]);

    const request = new Request("http://localhost", {
      headers: { authorization: "adk_live_sk_nonexistent12" },
    });
    expect(await authenticateRequest(request)).toBeNull();
  });

  it("rejects after rate limit is exceeded (100 requests/minute)", async () => {
    const rawKey = "adk_live_sk_ratelimited1234";
    const record = makeKeyRecord(rawKey, "user-rate-limit");

    for (let i = 0; i < 100; i++) {
      setupDb([record], []);
      const request = new Request("http://localhost", {
        headers: { authorization: rawKey },
      });
      expect(await authenticateRequest(request)).toEqual({ userId: "user-rate-limit" });
    }

    // 101st request is rejected
    setupDb([record]);
    const request = new Request("http://localhost", {
      headers: { authorization: rawKey },
    });
    expect(await authenticateRequest(request)).toBeNull();
  });
});

describe("createApiKey", () => {
  beforeEach(() => {
    setupDb();
  });

  it("generates a key with adk_live_sk_ prefix and stores hash", async () => {
    setupDb([{ id: "new-key-id" }]);

    const result = await createApiKey("user-create", "My Key");

    expect(result.key).toMatch(/^adk_live_sk_/);
    expect(result.id).toBe("new-key-id");
    expect(result.prefix).toBe(result.key.slice(0, 12));
    expect(result.prefix).toBe("adk_live_sk_");
  });
});

describe("revokeApiKey", () => {
  beforeEach(() => {
    setupDb();
  });

  it("returns true when key is found and deleted", async () => {
    setupDb([{ id: "key-1" }]);
    expect(await revokeApiKey("user-revoke-1", "key-1")).toBe(true);
  });

  it("returns false when key is not found", async () => {
    setupDb([]);
    expect(await revokeApiKey("user-revoke-2", "nonexistent")).toBe(false);
  });
});
