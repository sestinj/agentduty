import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/auth/session";
import { revokeApiKey } from "@/auth/api-keys";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const success = await revokeApiKey(userId, id);

  if (!success) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
