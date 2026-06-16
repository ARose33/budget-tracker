import { NextResponse, type NextRequest } from "next/server";
import { saveAndSyncTellerEnrollment } from "@/lib/teller/sync";
import type { TellerEnrollmentPayload } from "@/lib/teller/client";

export const runtime = "nodejs";

function isEnrollmentPayload(value: unknown): value is TellerEnrollmentPayload {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<TellerEnrollmentPayload>;
  return Boolean(
    candidate.accessToken &&
      candidate.enrollment &&
      typeof candidate.enrollment.id === "string"
  );
}

export async function POST(request: NextRequest) {
  try {
    const enrollment = (await request.json()) as unknown;
    if (!isEnrollmentPayload(enrollment)) {
      return NextResponse.json(
        { error: "Invalid Teller enrollment payload" },
        { status: 400 }
      );
    }

    const summary = await saveAndSyncTellerEnrollment(enrollment);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
