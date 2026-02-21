---
name: Webhook & Integration Correctness
description: Verify webhook handlers validate payloads, handle type coercion, and return proper responses for Slack/Twilio contracts.
---

# Webhook & Integration Correctness

## Context

This project receives webhooks from Slack and Twilio (`web/src/app/api/webhooks/`). Past PRs have introduced type errors in webhook routes, incorrect UUID vs short-code comparisons against the database, and missing payload validation. These bugs are particularly dangerous because they fail silently — the webhook returns a 500, the external service retries, and the issue only surfaces when users report missing notifications.

## What to Check

### 1. Webhook Payload Validation

Incoming webhook payloads from Slack and Twilio must be validated before use. Don't trust the shape of external data.

**BAD:**
```typescript
export async function POST(req: Request) {
  const body = await req.json();
  const userId = body.event.user; // crashes if event is undefined
  await processMessage(userId, body.event.text);
}
```

**GOOD:**
```typescript
export async function POST(req: Request) {
  const body = await req.json();
  if (!body.event?.user || !body.event?.text) {
    return new Response("Invalid payload", { status: 400 });
  }
  await processMessage(body.event.user, body.event.text);
}
```

Check that webhook handlers gracefully handle missing or malformed fields rather than crashing.

### 2. Identifier Type Coercion (UUID vs Short Code)

The database uses UUIDs for primary keys, but users and external systems may reference entities by short codes or other identifiers. Database lookups must handle both formats or explicitly validate the format.

**BAD:**
```typescript
// Assumes notificationId is always a UUID
const notification = await db.query.notifications.findFirst({
  where: eq(notifications.id, notificationId),
});
```

**GOOD:**
```typescript
// Check format and query accordingly
const isUUID = /^[0-9a-f-]{36}$/i.test(notificationId);
const notification = await db.query.notifications.findFirst({
  where: isUUID
    ? eq(notifications.id, notificationId)
    : eq(notifications.shortCode, notificationId),
});
```

Watch for `eq()` comparisons where the column type (UUID) doesn't match the input type (string from URL params or webhook payload).

### 3. Slack-Specific Response Requirements

Slack webhooks have specific response requirements:
- **Challenge verification**: `url_verification` events must echo back the `challenge` field
- **3-second timeout**: Slack expects a response within 3 seconds; long operations should be deferred to Inngest
- **Acknowledge first**: For interactive messages, return 200 immediately and process asynchronously
- **Duplicate events**: Slack may retry; handlers should be idempotent or check `x-slack-retry-num`

Check that new or modified Slack webhook handlers respect these contracts.

### 4. Twilio Response Format

Twilio expects TwiML or specific JSON responses. Returning plain text or incorrect status codes causes Twilio to retry or drop the message. Verify:
- Response content type matches Twilio's expectations
- Status codes are appropriate (200 for success, not 201 or 204)
- Error responses don't leak internal details to Twilio's logs

### 5. Database Mutations After Webhook Processing

When a webhook triggers a database mutation (e.g., updating notification status), ensure the updated entity is fetched and returned with its current state. Past bugs had mutations that didn't return the updated record, leaving the system in an inconsistent view.

## Key Files to Check

- `web/src/app/api/webhooks/slack/route.ts`
- `web/src/app/api/webhooks/twilio/route.ts`
- `web/src/schema/notification.ts`
- Any file handling inbound requests from external services

## Exclusions

- Outbound API calls to Slack/Twilio — those are client-side integrations, not webhook handlers.
- Internal API routes that only receive requests from the CLI — those have their own auth checks covered by the Auth & Security Patterns check.
