import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import {
  parseStatementText,
  type StatementAccountType,
  type StatementInstitution,
} from "@/lib/statements/parser";
import { getErrorMessage } from "@/lib/api/errors";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_FILE_SIZE = 15 * 1024 * 1024;

async function extractPdfLines(bytes: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({
    data: bytes,
    useSystemFonts: true,
  }).promise;
  const lines: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items
        .filter((item): item is typeof item & { str: string; transform: number[] } =>
          "str" in item && "transform" in item
        )
        .map((item) => ({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
        }))
        .filter((item) => item.text.trim());

      const rows: Array<{ y: number; items: typeof items }> = [];
      for (const item of items) {
        let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
        if (!row) {
          row = { y: item.y, items: [] };
          rows.push(row);
        }
        row.items.push(item);
      }

      rows
        .sort((a, b) => b.y - a.y)
        .forEach((row) => {
          lines.push(
            row.items
              .sort((a, b) => a.x - b.x)
              .map((item) => item.text)
              .join(" ")
          );
        });
    }
  } finally {
    await document.destroy();
  }

  return lines;
}

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
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "PDF files must be 15 MB or smaller" }, { status: 413 });
    }

    const accountType = formData.get("accountType");
    const institution = formData.get("institution");
    const lines = await extractPdfLines(new Uint8Array(await file.arrayBuffer()));
    const result = parseStatementText(lines, {
      targetYear: 2023,
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
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
