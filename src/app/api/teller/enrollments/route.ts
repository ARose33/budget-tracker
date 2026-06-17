import { NextResponse, type NextRequest } from "next/server";
import { saveAndSyncTellerEnrollment } from "@/lib/teller/sync";
import type { TellerEnrollmentPayload } from "@/lib/teller/client";
import { createServerClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/api/errors";

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
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const enrollment = (await request.json()) as unknown;
    if (!isEnrollmentPayload(enrollment)) {
      return NextResponse.json(
        { error: "Invalid Teller enrollment payload" },
        { status: 400 }
      );
    }

    const summary = await saveAndSyncTellerEnrollment(enrollment, user.id);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
