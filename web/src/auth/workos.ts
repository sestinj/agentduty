import { WorkOS } from "@workos-inc/node";

export const workos = new WorkOS(process.env.WORKOS_API_KEY!);

export const WORKOS_CLIENT_ID = process.env.WORKOS_CLIENT_ID!;
export const WORKOS_COOKIE_PASSWORD = process.env.WORKOS_COOKIE_PASSWORD!;
export const WORKOS_REDIRECT_URI =
  process.env.WORKOS_REDIRECT_URI || "http://localhost:3000/auth/callback";

export function getAuthorizationUrl() {
  return workos.userManagement.getAuthorizationUrl({
    provider: "authkit",
    clientId: WORKOS_CLIENT_ID,
    redirectUri: WORKOS_REDIRECT_URI,
  });
}
