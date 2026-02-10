import { NextResponse } from "next/server";
import { getAuthorizationUrl } from "@/auth/workos";

export async function GET() {
  const url = getAuthorizationUrl();
  return NextResponse.redirect(url);
}
