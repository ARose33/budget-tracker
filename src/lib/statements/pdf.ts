export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_PAGES = 100;
export async function extractPdfBytes(bytes: Uint8Array) {
  if (bytes.length > MAX_PDF_BYTES)
    throw new Error("PDF files must be 15 MB or smaller");
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
    throw new Error("Invalid PDF header");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: bytes,
    useSystemFonts: true,
    useWorkerFetch: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  const pages = [];
  let characters = 0;
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PDF_PAGES)
      throw new Error("Split statements into PDFs of 100 pages or fewer");
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items
        .filter(
          (
            item,
          ): item is typeof item & {
            str: string;
            transform: number[];
            width: number;
          } => "str" in item && "transform" in item && Boolean(item.str.trim()),
        )
        .map((item) => ({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width ?? 0,
        }));
      const grouped: Array<{ y: number; items: typeof items }> = [];
      for (const item of items) {
        characters += item.text.length;
        if (characters > 1000000)
          throw new Error("PDF contains too much text; split the file");
        let row = grouped.find(
          (candidate) => Math.abs(candidate.y - item.y) <= 2,
        );
        if (!row) {
          row = { y: item.y, items: [] };
          grouped.push(row);
        }
        row.items.push(item);
      }
      const lines = grouped
        .sort((a, b) => b.y - a.y)
        .map((row) => {
          const sorted = row.items.sort((a, b) => a.x - b.x);
          return {
            text: sorted
              .map((item) => item.text)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim(),
            y: row.y,
            xMin: Math.min(...sorted.map((item) => item.x)),
            xMax: Math.max(...sorted.map((item) => item.x + item.width)),
            items: sorted,
          };
        })
        .filter((line) => line.text);
      pages.push({
        pageNumber,
        lines,
        text: lines.map((line) => line.text).join("\n"),
      });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return {
    pageCount: pages.length,
    pages,
    text: pages.map((page) => page.text).join("\n"),
  };
}
