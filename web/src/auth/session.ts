import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { workos, WORKOS_COOKIE_PASSWORD } from "./workos";

export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session_token")?.value;
  if (!sessionToken) return null;

  try {
    const result =
      await workos.userManagement.authenticateWithSessionCookie({
        sessionData: sessionToken,
        cookiePassword: WORKOS_COOKIE_PASSWORD,
      });

    if (!result.authenticated) return null;

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.workosUserId, result.user.id));

    return user?.id ?? null;
  } catch {
    return null;
  }
}
