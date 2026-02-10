import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users, apiKeys } from "@/db/schema";
import { eq } from "drizzle-orm";
import { workos, WORKOS_COOKIE_PASSWORD } from "@/auth/workos";
import { ApiKeyManager } from "./api-key-manager";

async function getUser() {
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
      .select()
      .from(users)
      .where(eq(users.workosUserId, result.user.id));

    return user ?? null;
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const user = await getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.id));

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-zinc-400 mt-1">
              Welcome back, {user.name || user.email}
            </p>
          </div>
          <form action="/auth/logout" method="POST">
            <button
              type="submit"
              className="px-4 py-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 rounded-lg hover:border-zinc-500 transition"
            >
              Log out
            </button>
          </form>
        </div>

        <div className="border border-zinc-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">API Keys</h2>
          <p className="text-sm text-zinc-400 mb-6">
            Use API keys to authenticate requests from your agents. Keys are
            shown only once when created.
          </p>
          <ApiKeyManager existingKeys={keys} />
        </div>
      </div>
    </div>
  );
}
