export type StatementInstitution = "ally" | "capital_one" | "chase" | "sofi" | "unknown";
export type StatementAccountType = "checking" | "savings" | "credit_card";

export interface StatementTransaction {
  date: string;
  description: string;
  amount: number;
  sourceLine: string;
  confidence: "high" | "medium";
}

export interface StatementParseResult {
  institution: StatementInstitution;
  accountType: StatementAccountType;
  transactions: StatementTransaction[];
  excludedOutsideTargetYear: number;
  warnings: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONEY_PATTERN = /(?:\(\s*)?-?\$?\s*\d[\d,]*\.\d{2}-?(?:\s*\))?/g;
const SKIP_LINE_PATTERN =
  /\b(?:account\s+(?:summary|number)|annual percentage|average daily|beginning balance|closing balance|ending balance|new balance|previous balance|minimum payment|payment due|credit limit|available credit|interest charge calculation|year-to-date|total (?:fees|interest|deposits|withdrawals|payments|purchases|credits)|daily balance|page \d+|continued on)\b/i;
const CREDIT_PATTERN =
  /\b(?:payment|credit|refund|reversal|return|deposit|interest paid|direct dep|ach credit|transfer from|cashback|reward)\b/i;
const DEBIT_PATTERN =
  /\b(?:purchase|withdrawal|debit|fee|interest charge|check|bill pay|atm|transfer to|card purchase|zelle sent)\b/i;

function normalizeLine(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

function moneyToNumber(value: string) {
  const trimmed = value.trim();
  const negative =
    trimmed.startsWith("-") ||
    trimmed.endsWith("-") ||
    (trimmed.startsWith("(") && trimmed.endsWith(")"));
  const number = Number(trimmed.replace(/[$,()\s-]/g, ""));
  return Number.isFinite(number) ? (negative ? -number : number) : null;
}

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function detectInstitution(text: string): StatementInstitution {
  if (/\bally(?:\s+bank)?\b/i.test(text)) return "ally";
  if (/\bcapital\s+one\b/i.test(text)) return "capital_one";
  if (/\bchase\b|jpmorgan chase/i.test(text)) return "chase";
  if (/\bsofi\b|social finance/i.test(text)) return "sofi";
  return "unknown";
}

function detectAccountType(
  text: string,
  institution: StatementInstitution,
  hint?: StatementAccountType
): StatementAccountType {
  if (hint) return hint;
  if (
    /\b(?:quicksilver|freedom unlimited|credit card|credit account|credit access line)\b/i.test(
      text
    ) ||
    (institution === "chase" && /\bpayment due date\b/i.test(text))
  ) {
    return "credit_card";
  }
  if (/\bsavings\b/i.test(text)) return "savings";
  return "checking";
}

function findStatementYear(lines: string[], targetYear: number) {
  const yearCounts = new Map<number, number>();
  for (const line of lines.slice(0, 80)) {
    for (const match of line.matchAll(/\b(20\d{2})\b/g)) {
      const year = Number(match[1]);
      yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
    }
  }
  const ranked = [...yearCounts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] ?? targetYear;
}

interface DateMatch {
  date: string;
  end: number;
}

function dateAtStart(
  line: string,
  statementYear: number,
  yearByMonth: Map<number, number>
): DateMatch | null {
  const numeric = line.match(
    /^\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?\b/
  );
  if (numeric) {
    let year = numeric[3]
      ? Number(numeric[3])
      : yearByMonth.get(Number(numeric[1])) ?? statementYear;
    if (year < 100) year += 2000;
    const date = isoDate(year, Number(numeric[1]), Number(numeric[2]));
    return date ? { date, end: numeric[0].length } : null;
  }

  const named = line.match(
    /^\s*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i
  );
  if (!named) return null;
  const month = MONTHS[named[1].toLowerCase()];
  const date = isoDate(
    Number(named[3] ?? yearByMonth.get(month) ?? statementYear),
    month,
    Number(named[2])
  );
  return date ? { date, end: named[0].length } : null;
}

function findPeriodYears(lines: string[]) {
  const years = new Map<number, number>();
  for (const line of lines.slice(0, 80)) {
    const numericRange = line.match(
      /\b(\d{1,2})[/-]\d{1,2}[/-](\d{2}|\d{4})\s*(?:-|–|to|through)\s*(\d{1,2})[/-]\d{1,2}[/-](\d{2}|\d{4})\b/i
    );
    if (!numericRange) continue;
    const startYear =
      Number(numericRange[2]) < 100
        ? Number(numericRange[2]) + 2000
        : Number(numericRange[2]);
    const endYear =
      Number(numericRange[4]) < 100
        ? Number(numericRange[4]) + 2000
        : Number(numericRange[4]);
    years.set(Number(numericRange[1]), startYear);
    years.set(Number(numericRange[3]), endYear);
    break;
  }
  return years;
}

function removeSecondPostingDate(value: string) {
  return value.replace(
    /^\s*(?:\d{1,2}[/-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2})\s+/i,
    ""
  );
}

function cleanDescription(value: string) {
  return value
    .replace(MONEY_PATTERN, " ")
    .replace(/\s+\d{4,}\s*$/, "")
    .replace(/\s+/g, " ")
    .replace(/^[*•\s-]+|[*•\s-]+$/g, "")
    .trim();
}

function chooseAmount(
  line: string,
  description: string,
  accountType: StatementAccountType
) {
  const matches = [...line.matchAll(MONEY_PATTERN)];
  if (matches.length === 0) return null;

  const values = matches
    .map((match) => moneyToNumber(match[0]))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;

  // Deposit accounts commonly include a running balance as the final column.
  let raw = accountType === "credit_card" ? values.at(-1)! : values.at(-2) ?? values.at(-1)!;

  if (accountType === "credit_card") {
    if (raw > 0) raw = CREDIT_PATTERN.test(description) ? raw : -raw;
  } else if (raw > 0) {
    if (DEBIT_PATTERN.test(description) && !CREDIT_PATTERN.test(description)) raw = -raw;
  }

  return Math.round(raw * 100) / 100;
}

function transactionKey(row: StatementTransaction) {
  return `${row.date}|${row.amount.toFixed(2)}|${row.description.toLowerCase()}`;
}

export function parseStatementText(
  inputLines: string[],
  options: {
    targetYear?: number;
    institutionHint?: StatementInstitution;
    accountTypeHint?: StatementAccountType;
  } = {}
): StatementParseResult {
  const targetYear = options.targetYear ?? 2023;
  const lines = inputLines.map(normalizeLine).filter(Boolean);
  const text = lines.join("\n");
  const detectedInstitution = detectInstitution(text);
  const institution =
    options.institutionHint && options.institutionHint !== "unknown"
      ? options.institutionHint
      : detectedInstitution;
  const accountType = detectAccountType(text, institution, options.accountTypeHint);
  const statementYear = findStatementYear(lines, targetYear);
  const yearByMonth = findPeriodYears(lines);
  if (statementYear === targetYear + 1 && yearByMonth.size === 0) {
    // January statements often omit the year from each row while containing
    // both late-December and early-January activity.
    for (let month = 10; month <= 12; month += 1) yearByMonth.set(month, targetYear);
    for (let month = 1; month <= 3; month += 1) yearByMonth.set(month, statementYear);
  }
  const transactions: StatementTransaction[] = [];
  let excludedOutsideTargetYear = 0;

  for (const line of lines) {
    if (SKIP_LINE_PATTERN.test(line)) continue;
    const dateMatch = dateAtStart(line, statementYear, yearByMonth);
    if (!dateMatch) continue;

    const remainder = removeSecondPostingDate(line.slice(dateMatch.end));
    const moneyMatches = [...remainder.matchAll(MONEY_PATTERN)];
    if (moneyMatches.length === 0) continue;

    const description = cleanDescription(
      remainder.slice(0, moneyMatches[0].index ?? remainder.length)
    );
    if (description.length < 2 || /^(?:date|description|transaction|amount)$/i.test(description)) {
      continue;
    }

    const amount = chooseAmount(remainder, description, accountType);
    if (!amount || Math.abs(amount) > 10_000_000) continue;
    if (!dateMatch.date.startsWith(`${targetYear}-`)) {
      excludedOutsideTargetYear += 1;
      continue;
    }

    transactions.push({
      date: dateMatch.date,
      description,
      amount,
      sourceLine: line,
      confidence:
        institution !== "unknown" && (accountType === "credit_card" || moneyMatches.length >= 2)
          ? "high"
          : "medium",
    });
  }

  const unique = [...new Map(transactions.map((row) => [transactionKey(row), row])).values()];
  const warnings: string[] = [];
  if (institution === "unknown") {
    warnings.push("The bank could not be identified automatically; verify the account and amounts.");
  }
  if (unique.length === 0) {
    warnings.push(
      "No 2023 transaction rows were recognized. This may be an image-only PDF or an unsupported statement layout."
    );
  }
  if (unique.some((row) => row.confidence === "medium")) {
    warnings.push("Some amount signs were inferred from the transaction description; review them before import.");
  }

  return {
    institution,
    accountType,
    transactions: unique,
    excludedOutsideTargetYear,
    warnings,
  };
}
