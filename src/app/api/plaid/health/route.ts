import { NextResponse } from "next/server";
import { getPlaidServerConfigStatus } from "@/lib/plaid/client";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getPlaidServerConfigStatus());
}
