import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/auth/session";
import { createApiKey } from "@/auth/api-keys";

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await request.json();
  if (!name || typeof name !== "string") {
    return NextResponse.json(
      { error: "Name is required" },
      { status: 400 }
    );
  }

  const result = await createApiKey(userId, name);
  return NextResponse.json(result);
}
