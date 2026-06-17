import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";

const PROVIDER_ACCOUNT_ID = "manual:chase3568";
const ACCOUNT_NAME = "Chase Sapphire Reserve (...3568)";
const ACCOUNT_INSTITUTION = "Chase";
const UPLOAD_SOURCE = "chase_3568_csv";
const DEFAULT_OUTPUT_PATH = path.join(
  "imports",
  "chase3568_categorized_20260616.csv"
);

function parseEnv() {
  const envPath = path.resolve(".env.local");
  const env = fs.existsSync(envPath)
    ? Object.fromEntries(
        fs
          .readFileSync(envPath, "utf8")
          .split(/\r?\n/)
          .filter(Boolean)
          .filter((line) => !line.trim().startsWith("#"))
          .map((line) => {
            const index = line.indexOf("=");
            return [line.slice(0, index), line.slice(index + 1)];
          })
      )
    : {};

  return { ...env, ...process.env };
}

function toIsoDate(value) {
  const [month, day, year] = value.split("/");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeDescription(value) {
  return value.replaceAll("&amp;", "&").replace(/\s+/g, " ").trim();
}

function categorize(row) {
  const description = normalizeDescription(row.Description || "");
  const lower = description.toLowerCase();
  const chaseCategory = (row.Category || "").toLowerCase();
  const chaseType = (row.Type || "").toLowerCase();
  const amount = Number(row.Amount);

  if (chaseType === "payment" || lower.includes("payment thank you")) {
    return {
      group_name: "Transfers",
      line_item_name: "Credit Card Payment",
      category_type: "Transfer",
    };
  }

  if (amount > 0 || chaseType === "return") {
    return {
      group_name: "Credits",
      line_item_name: chaseType === "return" ? "Refund" : "Statement Credit",
      category_type: "Income",
    };
  }

  if (
    lower.includes("safeway") ||
    lower.includes("king soopers") ||
    chaseCategory === "groceries"
  ) {
    return {
      group_name: "Food",
      line_item_name: "Groceries",
      category_type: "Expense",
    };
  }

  if (
    lower.includes("uber") ||
    lower.includes("lyft") ||
    lower.includes("waymo") ||
    lower.includes("mta*") ||
    lower.includes("veo*") ||
    lower.includes("lime")
  ) {
    return {
      group_name: "Transportation",
      line_item_name: lower.includes("mta*")
        ? "Public Transit"
        : lower.includes("veo*") || lower.includes("lime")
          ? "Bike & Scooter"
          : "Rideshare",
      category_type: "Expense",
    };
  }

  if (
    lower.includes("parking") ||
    lower.includes("park") ||
    lower.includes("spothero")
  ) {
    return {
      group_name: "Transportation",
      line_item_name: "Parking",
      category_type: "Expense",
    };
  }

  if (chaseCategory === "gas" || lower.includes("conoco")) {
    return {
      group_name: "Transportation",
      line_item_name: "Gas",
      category_type: "Expense",
    };
  }

  if (
    lower.includes("united") ||
    lower.includes("southwes") ||
    lower.includes("frontier") ||
    lower.includes("airport") ||
    lower.includes("hilton") ||
    lower.includes("hampton inn") ||
    lower.includes("super.com") ||
    chaseCategory === "travel"
  ) {
    return {
      group_name: "Travel",
      line_item_name:
        lower.includes("hilton") ||
        lower.includes("hampton inn") ||
        lower.includes("super.com")
          ? "Lodging"
          : lower.includes("united") ||
              lower.includes("southwes") ||
              lower.includes("frontier")
            ? "Flights"
            : "Travel",
      category_type: "Expense",
    };
  }

  if (
    lower.includes("restaurant") ||
    lower.includes("tst*") ||
    lower.includes("snarf") ||
    lower.includes("chick-fil-a") ||
    lower.includes("chipotle") ||
    lower.includes("cava") ||
    lower.includes("rush bowls") ||
    lower.includes("doordash") ||
    lower.includes("coffee") ||
    chaseCategory === "food & drink"
  ) {
    return {
      group_name: "Food",
      line_item_name: "Restaurants",
      category_type: "Expense",
    };
  }

  if (
    lower.includes("home depot") ||
    lower.includes("ace hdwe") ||
    lower.includes("ace of denver") ||
    chaseCategory === "home"
  ) {
    return {
      group_name: "Home",
      line_item_name: "Home Improvement",
      category_type: "Expense",
    };
  }

  if (
    lower.includes("claude.ai") ||
    lower.includes("lovable") ||
    lower.includes("snowflake")
  ) {
    return {
      group_name: "Software",
      line_item_name: "AI & Cloud Tools",
      category_type: "Expense",
    };
  }

  if (
    lower.includes("golf") ||
    lower.includes("ball arena") ||
    lower.includes("flight club") ||
    chaseCategory === "entertainment"
  ) {
    return {
      group_name: "Entertainment",
      line_item_name: lower.includes("golf") ? "Golf" : "Events & Activities",
      category_type: "Expense",
    };
  }

  if (
    lower.includes("barber") ||
    lower.includes("livingnormally") ||
    chaseCategory === "personal" ||
    chaseCategory === "health & wellness"
  ) {
    return {
      group_name: "Personal",
      line_item_name:
        chaseCategory === "health & wellness" ? "Health & Wellness" : "Personal Care",
      category_type: "Expense",
    };
  }

  if (
    chaseCategory === "gifts & donations" ||
    lower.includes("americares")
  ) {
    return {
      group_name: "Giving",
      line_item_name: "Gifts & Donations",
      category_type: "Expense",
    };
  }

  if (
    chaseCategory === "professional services" ||
    lower.includes("dimov")
  ) {
    return {
      group_name: "Professional Services",
      line_item_name: "Tax & Legal",
      category_type: "Expense",
    };
  }

  if (chaseCategory === "fees & adjustments" || lower.includes("agent fee")) {
    return {
      group_name: "Fees",
      line_item_name: "Card Fees & Adjustments",
      category_type: "Expense",
    };
  }

  if (chaseCategory === "bills & utilities") {
    return {
      group_name: "Bills & Utilities",
      line_item_name: "Utilities",
      category_type: "Expense",
    };
  }

  if (chaseCategory === "education") {
    return {
      group_name: "Education",
      line_item_name: "Learning",
      category_type: "Expense",
    };
  }

  if (chaseCategory === "shopping") {
    return {
      group_name: "Shopping",
      line_item_name: "General Shopping",
      category_type: "Expense",
    };
  }

  return {
    group_name: "Miscellaneous",
    line_item_name: "Uncategorized Expense",
    category_type: "Expense",
  };
}

function parseCsv(filePath) {
  const parsed = Papa.parse(fs.readFileSync(filePath, "utf8"), {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    throw new Error(JSON.stringify(parsed.errors));
  }

  return parsed.data.map((row) => ({
    date: toIsoDate(row["Transaction Date"]),
    post_date: toIsoDate(row["Post Date"]),
    description: normalizeDescription(row.Description || ""),
    amount: Number(row.Amount),
    chase_category: row.Category || "",
    chase_type: row.Type || "",
    memo: row.Memo || "",
    category: categorize(row),
  }));
}

function toCsvValue(value) {
  const stringValue = value == null ? "" : String(value);
  if (!/[",\r\n]/.test(stringValue)) return stringValue;
  return `"${stringValue.replaceAll('"', '""')}"`;
}

function writeCategorizedCsv(rows, outputPath) {
  const headers = [
    "date",
    "post_date",
    "description",
    "amount",
    "chase_category",
    "chase_type",
    "group_name",
    "line_item_name",
    "category_type",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.date,
        row.post_date,
        row.description,
        row.amount,
        row.chase_category,
        row.chase_type,
        row.category.group_name,
        row.category.line_item_name,
        row.category.category_type,
      ]
        .map(toCsvValue)
        .join(",")
    ),
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`);
}

function summarizeRows(rows, extra = {}) {
  const byCategory = new Map();
  const byChaseCategory = new Map();
  const duplicateKeys = new Set();
  const seenKeys = new Set();

  for (const row of rows) {
    const key = `${row.category.group_name}: ${row.category.line_item_name}`;
    const chaseKey = row.chase_category || "(blank)";
    const duplicateKey = `${row.date}::${Number(row.amount).toFixed(2)}::${row.description}`;

    byCategory.set(key, (byCategory.get(key) || 0) + 1);
    byChaseCategory.set(chaseKey, (byChaseCategory.get(chaseKey) || 0) + 1);
    if (seenKeys.has(duplicateKey)) duplicateKeys.add(duplicateKey);
    seenKeys.add(duplicateKey);
  }

  return {
    parsed: rows.length,
    duplicateRowsInsideCsv: duplicateKeys.size,
    categories: Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]),
    chaseCategories: Array.from(byChaseCategory.entries()).sort((a, b) => b[1] - a[1]),
    ...extra,
  };
}

function transactionKey(row) {
  return `${row.date}::${Number(row.amount).toFixed(2)}::${row.description}`;
}

async function getUserId(supabase, explicitUserId) {
  if (explicitUserId) return explicitUserId;

  const { data, error } = await supabase
    .from("accounts")
    .select("user_id")
    .not("user_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.user_id) {
    throw new Error(
      "No user_id found. Set CHASE_IMPORT_USER_ID to the Supabase auth user id."
    );
  }
  return data.user_id;
}

async function getOrCreateAccount(supabase, userId, dryRun) {
  const { data: existing, error: lookupError } = await supabase
    .from("accounts")
    .select("id")
    .eq("plaid_account_id", PROVIDER_ACCOUNT_ID)
    .eq("user_id", userId)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existing) return existing.id;
  if (dryRun) return "dry-run-account-id";

  const { data, error } = await supabase
    .from("accounts")
    .insert({
      name: ACCOUNT_NAME,
      institution: ACCOUNT_INSTITUTION,
      type: "Credit Card",
      current_balance: null,
      plaid_account_id: PROVIDER_ACCOUNT_ID,
      user_id: userId,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function getOrCreateCategories(supabase, userId, categoryDefs, dryRun) {
  const { data: existing, error } = await supabase
    .from("budget_categories")
    .select("id, group_name, line_item_name")
    .eq("user_id", userId);

  if (error) throw error;

  const byKey = new Map(
    (existing || []).map((cat) => [
      `${cat.group_name}::${cat.line_item_name}`,
      cat.id,
    ])
  );

  for (const category of categoryDefs) {
    const key = `${category.group_name}::${category.line_item_name}`;
    if (byKey.has(key)) continue;
    if (dryRun) {
      byKey.set(key, `dry-run-${key}`);
      continue;
    }

    const { data, error: insertError } = await supabase
      .from("budget_categories")
      .insert({ ...category, user_id: userId })
      .select("id")
      .single();

    if (insertError) throw insertError;
    byKey.set(key, data.id);
  }

  return byKey;
}

async function existingTransactionKeys(supabase, userId, rows) {
  const minDate = rows.reduce((min, row) => (row.date < min ? row.date : min), rows[0].date);
  const maxDate = rows.reduce((max, row) => (row.date > max ? row.date : max), rows[0].date);
  const { data, error } = await supabase
    .from("transactions")
    .select("date, amount, description")
    .eq("user_id", userId)
    .gte("date", minDate)
    .lte("date", maxDate);

  if (error) throw error;
  return new Set(
    (data || []).map((row) => transactionKey(row))
  );
}

async function main() {
  const filePath = process.argv.find((arg) => arg.toLowerCase().endsWith(".csv"));
  const commit = process.argv.includes("--commit");
  const localOnly = process.argv.includes("--local-only");
  const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
  const outputPath = outputArg ? outputArg.slice("--output=".length) : DEFAULT_OUTPUT_PATH;
  if (!filePath) {
    throw new Error(
      "Usage: node scripts/import-chase-csv.js <file.csv> [--local-only] [--commit] [--output=imports/categorized.csv]"
    );
  }

  const rows = parseCsv(filePath);
  writeCategorizedCsv(rows, outputPath);

  if (localOnly) {
    console.log(
      JSON.stringify(
        summarizeRows(rows, {
          mode: "local-only",
          outputPath,
        }),
        null,
        2
      )
    );
    return;
  }

  const env = parseEnv();
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const userId = await getUserId(supabase, env.CHASE_IMPORT_USER_ID);
  const accountId = await getOrCreateAccount(supabase, userId, !commit);
  const categoryDefs = Array.from(
    new Map(rows.map((row) => [`${row.category.group_name}::${row.category.line_item_name}`, row.category])).values()
  );
  const categoryIds = await getOrCreateCategories(supabase, userId, categoryDefs, !commit);
  const existingKeys = await existingTransactionKeys(supabase, userId, rows);

  const seenCsvKeys = new Set();
  const insertRows = [];

  for (const row of rows) {
    const key = transactionKey(row);
    if (existingKeys.has(key) || seenCsvKeys.has(key)) continue;
    seenCsvKeys.add(key);

    const categoryKey = `${row.category.group_name}::${row.category.line_item_name}`;
    insertRows.push({
      date: row.date,
      description: row.description,
      amount: row.amount,
      category_id: categoryIds.get(categoryKey),
      category: `${row.category.group_name}: ${row.category.line_item_name}`,
      account_id: accountId,
      account: ACCOUNT_NAME,
      status: "Unconfirmed",
      source: "chase_csv",
      upload_source: UPLOAD_SOURCE,
      not_duplicate: false,
      user_id: userId,
    });
  }

  if (commit && insertRows.length > 0) {
    const { error } = await supabase.from("transactions").insert(insertRows);
    if (error) throw error;
  }

  console.log(
    JSON.stringify(
      {
        ...summarizeRows(rows),
        mode: commit ? "commit" : "dry-run",
        toInsert: insertRows.length,
        skippedAsDuplicates: rows.length - insertRows.length,
        outputPath,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
