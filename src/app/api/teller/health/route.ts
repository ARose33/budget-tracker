import { NextResponse } from "next/server";
import { getTellerServerConfigStatus } from "@/lib/teller/client";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getTellerServerConfigStatus());
}
