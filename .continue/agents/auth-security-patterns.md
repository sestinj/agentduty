---
name: Auth & Security Patterns
description: Catch JWT handling issues, missing API key auth, token refresh edge cases, and authorization header handling.
---

# Auth & Security Patterns

## Context

This project uses WorkOS for authentication (`web/src/auth/workos.ts`) with JWT tokens (jose library) and a custom API key system. Past PRs have repeatedly introduced bugs in auth flows — JWT claims missing required fields, authorization headers stripped on redirects, and new endpoints shipped without API key authentication. These issues bypass TypeScript's static analysis because they involve runtime behavior and external service contracts.

## What to Check

### 1. JWT Token Handling

Ensure JWT creation and verification includes all required claims. The `sub` claim alone has been insufficient — `email` is also required by the database schema.

**BAD:**
```typescript
const token = await new SignJWT({ sub: userId })
  .setProtectionHeader({ alg: 'HS256' })
  .sign(secret);
```

**GOOD:**
```typescript
const token = await new SignJWT({ sub: userId, email: userEmail })
  .setProtectionHeader({ alg: 'HS256' })
  .sign(secret);
```

Check that token verification extracts and validates all fields the downstream code depends on, not just the `sub` claim.

### 2. API Key Authentication on New Endpoints

Any new API route in `web/src/app/api/` must include authentication — either JWT verification or API key validation. Look for route handlers that access data without calling an auth function first.

**BAD:**
```typescript
export async function POST(req: Request) {
  const body = await req.json();
  // Directly accessing DB without auth
  const result = await db.insert(notifications).values(body);
}
```

**GOOD:**
```typescript
export async function POST(req: Request) {
  const user = await authenticateRequest(req);
  if (!user) return new Response("Unauthorized", { status: 401 });
  const body = await req.json();
  const result = await db.insert(notifications).values(body);
}
```

### 3. HTTP Redirect and Header Preservation

When configuring API base URLs or making HTTP requests that may redirect (especially 307s), verify that authorization headers are preserved. The CLI previously had a bug where a trailing-slash redirect stripped the `Authorization` header.

Check for:
- API base URLs that might cause redirects (missing trailing slashes, HTTP vs HTTPS)
- Custom HTTP clients that don't handle redirect header forwarding
- Changes to `cli/internal/client/` that modify request configuration

### 4. Token Refresh Logic

In the Go CLI (`cli/internal/client/`), token refresh must retry the original request after refreshing. Check that refresh flows:
- Actually retry the failed request with the new token
- Don't enter infinite refresh loops
- Handle refresh token expiration gracefully

## Key Files to Check

- `web/src/auth/workos.ts`
- `web/src/app/api/**/route.ts`
- `cli/internal/client/`
- Any file importing `jose` or `SignJWT`

## Exclusions

- Webhook endpoints that use their own verification (e.g., Slack signature verification) — these have separate auth mechanisms.
- Public health check or status endpoints that are intentionally unauthenticated.
