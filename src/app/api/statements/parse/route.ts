import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import {
  parseStatementText,
  type StatementAccountType,
  type StatementInstitution,
} from "@/lib/statements/parser";
import { z } from "zod";
import { extractPdfBytes, MAX_PDF_BYTES } from "@/lib/statements/pdf";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A PDF file is required" }, { status: 400 });
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF statements are supported" }, { status: 415 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "PDF files must be 15 MB or smaller" }, { status: 413 });
    }

    const targetYear = z.coerce.number().int().min(1900).max(2100).safeParse(formData.get("targetYear"));
    if (!targetYear.success) return NextResponse.json({ error: "Provide targetYear (1900–2100); no year is assumed." }, { status: 400 });
    const accountType = formData.get("accountType");
    const institution = formData.get("institution");
    const document = await extractPdfBytes(new Uint8Array(await file.arrayBuffer()));
    const lines = document.pages.flatMap(page => page.lines.map(line => line.text));
    if (!lines.length) return NextResponse.json({ error: "This PDF has no extractable text. Use a text-based statement." }, { status: 422 });
    const result = parseStatementText(lines, {
      targetYear: targetYear.data,
      accountTypeHint:
        accountType === "checking" ||
        accountType === "savings" ||
        accountType === "credit_card"
          ? (accountType as StatementAccountType)
          : undefined,
      institutionHint:
        institution === "ally" ||
        institution === "capital_one" ||
        institution === "chase" ||
        institution === "sofi"
          ? (institution as StatementInstitution)
          : undefined,
    });

    return NextResponse.json({
      ...result,
      fileName: file.name,
      pagesHaveText: lines.length > 0,
    });
  } catch {
    return NextResponse.json({ error: "Could not read this PDF. Check that it is readable, not password-protected, and at most 100 pages." }, { status: 422 });
  }
}
