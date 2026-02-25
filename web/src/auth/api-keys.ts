import crypto from "crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "@/db";
import { apiKeys, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { workos, WORKOS_CLIENT_ID } from "./workos";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

// Cache the JWKS fetcher (it handles caching internally).
const workosJWKS = createRemoteJWKSet(
  new URL(`https://api.workos.com/sso/jwks/${WORKOS_CLIENT_ID}`)
);

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= 100;
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function hashKey(key: string): Promise<string> {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export async function authenticateRequest(
  request: Request
): Promise<{ userId: string } | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;

  // API key authentication (sent directly or as Bearer token)
  if (authHeader.startsWith("adk_")) {
    return authenticateApiKey(authHeader);
  }

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);

    // API key sent as Bearer token
    if (token.startsWith("adk_")) {
      return authenticateApiKey(token);
    }

    // WorkOS JWT access token (from device flow or session)
    return authenticateJWT(token);
  }

  return null;
}

async function authenticateApiKey(
  key: string
): Promise<{ userId: string } | null> {
  const prefix = key.slice(0, 12);
  const now = new Date();

  const results = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, prefix));

  if (results.length === 0) return null;

  const keyHash = await hashKey(key);

  for (const keyRecord of results) {
    if (keyRecord.expiresAt && keyRecord.expiresAt < now) continue;
    if (!timingSafeEqual(keyHash, keyRecord.keyHash)) continue;
    if (!checkRateLimit(keyRecord.userId)) return null;

    // Update last_used_at (fire-and-forget)
    db.update(apiKeys)
      .set({ lastUsedAt: now })
      .where(eq(apiKeys.id, keyRecord.id))
      .then(() => {});

    return { userId: keyRecord.userId };
  }

  return null;
}

async function authenticateJWT(
  token: string
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, workosJWKS);

    // The `sub` claim is the WorkOS user ID.
    const workosUserId = payload.sub;
    if (!workosUserId) return null;

    let dbResult = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.workosUserId, workosUserId));

    if (dbResult.length === 0) {
      // User authenticated via WorkOS (e.g. CLI device flow) but not yet in DB,
      // or their workosUserId changed (e.g. switching WorkOS environments).
      const workosUser = await workos.userManagement.getUser(workosUserId);

      // Try to find existing user by email first.
      const [existingByEmail] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, workosUser.email));

      if (existingByEmail) {
        // Update their workosUserId to the current one.
        await db
          .update(users)
          .set({ workosUserId, updatedAt: new Date() })
          .where(eq(users.id, existingByEmail.id));
        dbResult = [existingByEmail];
      } else {
        const [newUser] = await db
          .insert(users)
          .values({
            email: workosUser.email,
            name:
              [workosUser.firstName, workosUser.lastName]
                .filter(Boolean)
                .join(" ") || null,
            workosUserId,
          })
          .returning({ id: users.id });
        dbResult = [newUser];
      }
    }

    if (!checkRateLimit(dbResult[0].id)) return null;
    return { userId: dbResult[0].id };
  } catch (err) {
    console.error("JWT auth error:", err);
    return null;
  }
}

export async function createApiKey(
  userId: string,
  name: string
): Promise<{ key: string; id: string; prefix: string }> {
  const rawKey = `adk_live_sk_${crypto.randomBytes(24).toString("base64url")}`;
  const prefix = rawKey.slice(0, 12);
  const keyHash = await hashKey(rawKey);

  const [record] = await db
    .insert(apiKeys)
    .values({
      userId,
      keyHash,
      keyPrefix: prefix,
      name,
    })
    .returning({ id: apiKeys.id });

  return { key: rawKey, id: record.id, prefix };
}

export async function revokeApiKey(
  userId: string,
  keyId: string
): Promise<boolean> {
  const result = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .returning({ id: apiKeys.id });

  return result.length > 0;
}
