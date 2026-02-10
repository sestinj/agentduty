import { NextRequest, NextResponse } from "next/server";
import { workos, WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD } from "@/auth/workos";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  try {
    const authResponse = await workos.userManagement.authenticateWithCode({
      code,
      clientId: WORKOS_CLIENT_ID,
      session: {
        sealSession: true,
        cookiePassword: WORKOS_COOKIE_PASSWORD,
      },
    });

    const workosUser = authResponse.user;

    // Create or update user
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.workosUserId, workosUser.id));

    if (existingUser) {
      await db
        .update(users)
        .set({
          email: workosUser.email,
          name:
            [workosUser.firstName, workosUser.lastName]
              .filter(Boolean)
              .join(" ") || existingUser.name,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingUser.id));
    } else {
      await db.insert(users).values({
        email: workosUser.email,
        name:
          [workosUser.firstName, workosUser.lastName]
            .filter(Boolean)
            .join(" ") || null,
        workosUserId: workosUser.id,
      });
    }

    // Set session cookie with sealed session data
    const cookieStore = await cookies();
    if (authResponse.sealedSession) {
      cookieStore.set("session_token", authResponse.sealedSession, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 1 week
        path: "/",
      });
    }

    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (error) {
    console.error("Auth callback error:", error);
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
}
