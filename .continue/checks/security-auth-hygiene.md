---
name: Security & Auth Hygiene
description: Catch missing webhook signature verification, unauthenticated API routes, leaked secrets, and unsafe credential handling.
---

# Security & Auth Hygiene

## Context

AgentDuty is an on-call notification system that handles sensitive operations: sending Slack/Twilio messages, managing API keys, and processing inbound webhooks. The codebase uses WorkOS for SSO, JWT verification via JWKS, and custom API key auth with SHA-256 hashing (`web/src/auth/api-keys.ts`). The Slack webhook route properly verifies request signatures (`web/src/app/api/webhooks/slack/route.ts`), but the Twilio webhook route currently has no signature verification — this check ensures that pattern doesn't repeat.

## What to Check

### 1. Webhook Signature Verification

Every inbound webhook route under `web/src/app/api/webhooks/` MUST verify the request signature from the upstream service before processing the payload. Slack's implementation is the reference pattern.

**GOOD** — Slack webhook verifies signature before processing:
```typescript
// web/src/app/api/webhooks/slack/route.ts
if (!verifySlackSignature(body, timestamp, signature)) {
  return new Response("Invalid signature", { status: 401 });
}
```

**BAD** — Twilio webhook processes requests without signature verification:
```typescript
// web/src/app/api/webhooks/twilio/route.ts
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  // No signature check — anyone can forge inbound SMS
  const twiml = await handleInboundSMS(payload);
}
```

If a new webhook integration is added (e.g., PagerDuty, GitHub), flag it if it lacks signature verification.

### 2. Authentication on API Routes

All API routes under `web/src/app/api/` must either:
- Call `getSessionUserId()` or `authenticateRequest()` and return 401 if null, OR
- Be a webhook endpoint with its own signature verification (see above), OR
- Be an internal framework route (e.g., Inngest serve handler)

The GraphQL endpoint (`web/src/app/api/graphql/route.ts`) passes auth context to resolvers but allows unauthenticated requests through. If new GraphQL resolvers are added that perform mutations or return sensitive data, flag any that don't check `context.userId`.

**GOOD** — API key route checks session:
```typescript
// web/src/app/api/keys/route.ts
const userId = await getSessionUserId();
if (!userId) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

**BAD** — New API route missing auth check:
```typescript
export async function POST(request: NextRequest) {
  const { teamId } = await request.json();
  // Missing auth — anyone can hit this endpoint
  await db.delete(teams).where(eq(teams.id, teamId));
}
```

### 3. Secrets and Credentials

- **No secrets in client-side code**: Files under `web/src/app/` that are React components (not route handlers) must never reference `process.env` variables that don't start with `NEXT_PUBLIC_`. Next.js only exposes `NEXT_PUBLIC_*` vars to the browser, but referencing a server secret in a client component is a logic error that may cause crashes or confusion.
- **No hardcoded credentials**: Flag any hardcoded API keys, tokens, passwords, or connection strings in source code. They should always come from environment variables.
- **No secrets in logs**: Flag any `console.log` or logging call that outputs auth headers, API keys, tokens, or passwords.

**BAD** — Logging a token:
```typescript
console.log("Auth header:", request.headers.get("authorization"));
```

### 4. Input Validation on Webhook Payloads

Inbound webhook handlers (`web/src/webhooks/`) receive external data. Flag if:
- Form data or JSON fields are cast with `as string` without null/type checking
- User-supplied strings are interpolated into database queries outside of Drizzle's parameterized API
- Webhook payloads are passed to `JSON.parse()` without try/catch

**BAD** — Unsafe casting without validation:
```typescript
const payload = {
  From: formData.get("From") as string,  // Could be null
  Body: formData.get("Body") as string,
};
```

**GOOD** — Validate before using:
```typescript
const from = formData.get("From");
if (typeof from !== "string" || !from) {
  return new Response("Bad Request", { status: 400 });
}
```

## Key Files to Check

- `web/src/app/api/**/*.ts` — All API route handlers
- `web/src/webhooks/**/*.ts` — Inbound webhook processing logic
- `web/src/auth/**/*.ts` — Authentication and session management
- `web/src/channels/**/*.ts` — Outbound integrations (Slack, Twilio)
- `web/src/inngest/**/*.ts` — Background workflow functions
- `web/src/db/schema.ts` — Database schema (check for sensitive field handling)

## Exclusions

- `web/src/app/auth/callback/route.ts` — The OAuth callback route intentionally handles unauthenticated requests (it's the login flow).
- `web/src/app/api/inngest/route.ts` — Inngest's serve handler manages its own auth via signing keys.
- Environment variable references in config files (`drizzle.config.ts`, `next.config.ts`) — these run server-side only.
