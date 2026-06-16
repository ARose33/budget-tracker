import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getTellerConnectConfig } from "@/lib/teller/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const nonce = randomUUID();
    const response = NextResponse.json({
      ...getTellerConnectConfig(),
      nonce,
    });

    response.cookies.set("teller_nonce", nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60,
      path: "/",
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
