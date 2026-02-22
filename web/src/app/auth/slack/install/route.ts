import { NextResponse } from "next/server";

const SCOPES = [
  "chat:write",
  "files:read",
  "im:history",
  "im:read",
  "im:write",
  "reactions:write",
].join(",");

export async function GET(request: Request) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "SLACK_CLIENT_ID not configured" },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id") || "";

  const baseUrl =
    process.env.NEXT_PUBLIC_URL || "https://www.agentduty.dev";
  const redirectUri = `${baseUrl}/auth/slack/callback`;

  const slackUrl = new URL("https://slack.com/oauth/v2/authorize");
  slackUrl.searchParams.set("client_id", clientId);
  slackUrl.searchParams.set("scope", SCOPES);
  slackUrl.searchParams.set("redirect_uri", redirectUri);
  if (userId) {
    slackUrl.searchParams.set("state", userId);
  }

  return NextResponse.redirect(slackUrl.toString());
}
