import { NextResponse } from "next/server";
import { db } from "@/db";
import { slackInstallations, users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // userId passed from connect flow
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?slack_error=${error}`, process.env.NEXT_PUBLIC_URL || "https://www.agentduty.dev")
    );
  }

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  // Exchange code for token
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("SLACK_CLIENT_ID or SLACK_CLIENT_SECRET not set");
    return NextResponse.json(
      { error: "Slack OAuth not configured" },
      { status: 500 }
    );
  }

  const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_URL || "https://www.agentduty.dev"}/auth/slack/callback`,
    }),
  });

  const data = await tokenResponse.json();

  if (!data.ok) {
    console.error("Slack OAuth error:", data.error);
    return NextResponse.redirect(
      new URL(`/?slack_error=${data.error}`, process.env.NEXT_PUBLIC_URL || "https://www.agentduty.dev")
    );
  }

  const teamId = data.team?.id;
  const teamName = data.team?.name;
  const botToken = data.access_token;
  const botUserId = data.bot_user_id;
  const authedUserId = data.authed_user?.id; // Slack user ID of the person who installed

  if (!teamId || !botToken) {
    return NextResponse.json(
      { error: "Invalid OAuth response" },
      { status: 500 }
    );
  }

  // Upsert the installation
  const [existing] = await db
    .select()
    .from(slackInstallations)
    .where(eq(slackInstallations.teamId, teamId));

  if (existing) {
    await db
      .update(slackInstallations)
      .set({
        botToken,
        botUserId,
        teamName,
        updatedAt: new Date(),
      })
      .where(eq(slackInstallations.teamId, teamId));
  } else {
    await db.insert(slackInstallations).values({
      teamId,
      teamName,
      botToken,
      botUserId,
    });
  }

  // If we have a state (userId) and the authed Slack user, link them
  if (state && authedUserId) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, state));

    if (user) {
      await db
        .update(users)
        .set({
          slackUserId: authedUserId,
          slackTeamId: teamId,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
    }
  }

  return NextResponse.redirect(
    new URL("/?slack=connected", process.env.NEXT_PUBLIC_URL || "https://www.agentduty.dev")
  );
}
