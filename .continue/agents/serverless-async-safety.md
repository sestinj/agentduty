---
name: Serverless Async Safety
description: Flag unawaited async operations in serverless handlers and catch lazy initialization issues at build time.
---

# Serverless Async Safety

## Context

This project runs on Next.js with serverless functions (Vercel/similar). Past PRs introduced bugs where async operations were fired without `await`, causing the serverless function to terminate before the operation completed. For example, notification delivery was not awaited before returning the response to the CLI, resulting in silently dropped notifications. The project also uses Inngest for background jobs, which has its own execution model.

## What to Check

### 1. Unawaited Async Calls in Route Handlers

Every async operation inside a Next.js API route handler (`web/src/app/api/**/route.ts`) must be awaited before the response is returned. In serverless environments, the runtime can freeze or terminate after the response is sent.

**BAD:**
```typescript
export async function POST(req: Request) {
  const data = await req.json();
  deliverNotification(data); // fire-and-forget — will be killed
  return Response.json({ success: true });
}
```

**GOOD:**
```typescript
export async function POST(req: Request) {
  const data = await req.json();
  await deliverNotification(data); // awaited before response
  return Response.json({ success: true });
}
```

Also watch for patterns like `Promise.all` where one promise in the array is missing, or `.then()` chains that aren't awaited.

### 2. Unawaited Calls in GraphQL Resolvers

GraphQL mutation resolvers in the schema files (`web/src/schema/`) have the same serverless constraint. Any side effect (sending notifications, updating external services) must complete before the resolver returns.

Check for:
- Database mutations followed by unawaited notification/webhook calls
- Resolvers that return data before side effects complete

### 3. Lazy Initialization in Module Scope

Clients that connect to external services (database, Slack, Twilio) should not perform lazy initialization that fails at build time. Next.js pre-renders pages and may execute module-scope code during `next build`.

**BAD:**
```typescript
// Module scope — runs at build time
const slackClient = new WebClient(process.env.SLACK_TOKEN!);
```

**GOOD:**
```typescript
// Lazy singleton — only initializes when first called
let _slackClient: WebClient;
function getSlackClient() {
  if (!_slackClient) {
    _slackClient = new WebClient(process.env.SLACK_TOKEN!);
  }
  return _slackClient;
}
```

Check that environment variables accessed at module scope are available at build time, or that initialization is deferred.

### 4. Inngest Function Patterns

When using Inngest (`web/src/inngest/`), ensure:
- `step.run()` callbacks don't contain unawaited promises
- Long-running operations are properly broken into steps
- Error handling doesn't swallow failures silently

## Key Files to Check

- `web/src/app/api/**/route.ts`
- `web/src/schema/*.ts` (GraphQL resolvers)
- `web/src/inngest/`
- Any file that calls external services (Slack, Twilio, database)

## Exclusions

- Inngest's own `step.sendEvent()` — this is fire-and-forget by design within the Inngest execution model.
- Logging calls (`console.log`, `console.error`) — these are synchronous and safe.
- Operations inside `waitUntil()` if using Vercel's `waitUntil` API — these are explicitly designed for post-response work.
