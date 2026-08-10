import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MONTHS = {
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

const MONTH_NAME =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const MONEY_TOKEN = /(?<![\d,])(?:-\s*)?\$?\s*(?:\d[\d,]*)?\.\d{2}-?(?!\d)/g;

function cleanText(value) {
  return value
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[•·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDate(year, month, day) {
  const result = new Date(Date.UTC(year, month - 1, day));
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function expandYear(value) {
  const year = Number(value);
  return year < 100 ? year + 2000 : year;
}

function namedDate(monthName, day, year) {
  return isoDate(expandYear(year), MONTHS[monthName.toLowerCase()], Number(day));
}

function numericDate(month, day, year) {
  return isoDate(expandYear(year), Number(month), Number(day));
}

function parseMoney(value) {
  const normalized = value.replace(/\s+/g, "").trim();
  const negative =
    normalized.startsWith("-") ||
    normalized.endsWith("-") ||
    (normalized.startsWith("(") && normalized.endsWith(")"));
  const number = Number(normalized.replace(/[$,()\s+-]/g, ""));
  if (!Number.isFinite(number)) return null;
  return Math.round((negative ? -number : number) * 100) / 100;
}

function moneyValues(line) {
  return [...line.matchAll(MONEY_TOKEN)]
    .map((match) => ({
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      raw: match[0],
      value: parseMoney(match[0]),
    }))
    .filter((match) => match.value !== null);
}

function normalizeDescription(value) {
  return cleanText(value)
    .replace(/^[\s:,-]+|[\s:,-]+$/g, "")
    .replace(/^&\s+/, "")
    .replace(/\s+(?:Card \d{4}|Transaction#:\s*\d+)$/i, "")
    .trim();
}

function normalizedMatchDescription(value) {
  return normalizeDescription(value)
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/&/g, "and")
    .replace(/\b(?:auth(?:orization)?|confirmation|reference|transaction|trace|card)\s*(?:date|number|no|#)?\s*[:#-]?\s*[a-z0-9-]+\b/gi, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function rowId(row) {
  return sha256(
    [
      row.statementAccountKey,
      row.transactionDate,
      row.postedDate ?? "",
      row.amount.toFixed(2),
      normalizedMatchDescription(row.description),
      row.statementFile,
      row.page ?? "",
      row.rowReference ?? "",
    ].join("|")
  );
}

function makeTransaction(base, input) {
  const description = normalizeDescription(input.description);
  const transaction = {
    statementAccountKey: input.statementAccountKey,
    transactionDate: input.transactionDate,
    postedDate: input.postedDate ?? null,
    amount: Math.round(input.amount * 100) / 100,
    description,
    normalizedDescription: normalizedMatchDescription(description),
    statementFile: base.relativePath,
    statementPeriodStart: base.periodStart,
    statementPeriodEnd: base.periodEnd,
    page: input.page ?? null,
    rowReference: input.rowReference ?? null,
    sourceLine: input.sourceLine,
    parser: base.parser,
    confidence: input.confidence ?? "high",
  };
  transaction.sourceRecordId = rowId(transaction);
  return transaction;
}

function inferYearForMonth(month, periodStart, periodEnd) {
  if (!periodStart || !periodEnd) return Number(periodEnd?.slice(0, 4) ?? periodStart?.slice(0, 4));
  const startYear = Number(periodStart.slice(0, 4));
  const endYear = Number(periodEnd.slice(0, 4));
  if (startYear === endYear) return startYear;
  const startMonth = Number(periodStart.slice(5, 7));
  return month >= startMonth ? startYear : endYear;
}

function parsePeriod(text) {
  const numeric = text.match(
    /(?:Opening\/?Closing Date\s*)?(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:-|–|—|through|to)\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i
  );
  if (numeric) {
    return {
      start: numericDate(numeric[1], numeric[2], numeric[3]),
      end: numericDate(numeric[4], numeric[5], numeric[6]),
    };
  }

  const named = text.match(
    new RegExp(
      `(${MONTH_NAME})\\s+(\\d{1,2}),?\\s+(20\\d{2})\\s*(?:-|–|—|through|to)\\s*(${MONTH_NAME})\\s+(\\d{1,2}),?\\s+(20\\d{2})`,
      "i"
    )
  );
  if (named) {
    return {
      start: namedDate(named[1], named[2], named[3]),
      end: namedDate(named[4], named[5], named[6]),
    };
  }

  const statementPeriod = text.match(
    new RegExp(
      `STATEMENT PERIOD\\s*(${MONTH_NAME})\\s+(\\d{1,2})\\s*(?:-|–|—|through|to)\\s*(${MONTH_NAME})\\s+(\\d{1,2}),?\\s+(20\\d{2})`,
      "i"
    )
  );
  if (statementPeriod) {
    const endMonth = MONTHS[statementPeriod[3].toLowerCase()];
    const endYear = Number(statementPeriod[5]);
    const startMonth = MONTHS[statementPeriod[1].toLowerCase()];
    const startYear = startMonth > endMonth ? endYear - 1 : endYear;
    return {
      start: isoDate(startYear, startMonth, Number(statementPeriod[2])),
      end: isoDate(endYear, endMonth, Number(statementPeriod[4])),
    };
  }

  const balanceDates = text.match(
    /Beginning Balance(?:,)?\s*(?:as of\s*)?(\d{1,2})\/(\d{1,2})\/(\d{2,4})[\s\S]{0,1200}?Ending Balance(?:,)?\s*(?:as of\s*)?(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i
  );
  if (balanceDates) {
    return {
      start: numericDate(balanceDates[1], balanceDates[2], balanceDates[3]),
      end: numericDate(balanceDates[4], balanceDates[5], balanceDates[6]),
    };
  }

  return { start: null, end: null };
}

function detectParser(folder, text) {
  const lowerFolder = folder.toLowerCase();
  if (lowerFolder.includes("ally")) return "ally_combined_deposit";
  if (lowerFolder.includes("cap1 savings")) return "capital_one_combined_deposit";
  if (lowerFolder.includes("grasshopper")) return "grasshopper_deposit";
  if (lowerFolder.includes("chase checking") || lowerFolder.includes("chase savings")) {
    return "chase_deposit";
  }
  if (lowerFolder.includes("chase freedom") || lowerFolder.includes("chase reserve")) {
    return "chase_credit_card";
  }
  if (lowerFolder.includes("quicksilver") || /capital one/i.test(text)) {
    return "capital_one_credit_card";
  }
  return "unknown";
}

function statementAccountFromFolder(folder) {
  const normalized = folder.toLowerCase();
  if (normalized.includes("chase checking")) return "chase:checking:4522";
  if (normalized.includes("chase savings")) return "chase:savings:0326";
  if (normalized.includes("chase freedom")) return "chase:credit_card:6158";
  if (normalized.includes("chase reserve")) return "chase:credit_card:5420";
  if (normalized.includes("grasshopper")) return "grasshopper:checking:6265";
  if (normalized.includes("quicksilver")) return "capital_one:credit_card:9401";
  return null;
}

function accountKey(institution, type, last4) {
  return `${institution}:${type}:${last4}`;
}

function appendContinuation(pending, line) {
  if (!pending) return;
  const text = normalizeDescription(line.text);
  if (!text || /^(?:Page \d+|Account Number|Statement Date|Customer Service)/i.test(text)) return;
  if (
    /\bPage \d+ of \d+\b|\bStatement Date:|\bFIS\d+\b|ACCOUNT ACTIVITY(?: \(CONTINUED\))?/i.test(
      text
    ) ||
    /\bPage\s*:\s*\d+\s+of\s+\d+\b|\bM\d{6}S\d+\b|ROSE RESIDENCES|Transaction Detail \(Continued\)|Date Description Deposits Withdrawals Balance/i.test(
      text
    ) ||
    /^(?:Date of|Transaction|Post Date|Description|Amount)$/i.test(text)
  ) {
    return;
  }
  if (
    /^(?:Fees Summary|Summary|Earnings Summary|Overdraft|Interest Charge Calculation|Ending Balance|\*end\*|Page \d+)/i.test(
      text
    ) ||
    /Totals Year-to-Date|Total Transactions|Total Fees|Total Interest|Additional Information on the next page|Billing Cycle Transactions \(Continued\)|Trans Date Post Date Description Amount/i.test(
      text
    )
  ) {
    return;
  }
  pending.description = normalizeDescription(`${pending.description} ${text}`);
  pending.sourceLine = `${pending.sourceLine} | ${text}`;
}

function parseCapitalOneDeposit(document, base) {
  const transactions = [];
  let currentAccount = null;

  for (const page of document.pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const line = page.lines[index];
      const text = cleanText(line.text);
      const accountHeader = text.match(/^(Cap1 Check|360 Performance Savings).*?(\d{4})\s*$/i);
      if (accountHeader) {
        currentAccount = accountHeader[1].toLowerCase().includes("saving")
          ? accountKey("capital_one", "savings", accountHeader[2])
          : accountKey("capital_one", "checking", accountHeader[2]);
        continue;
      }
      if (!currentAccount) continue;

      const row = text.match(
        new RegExp(`^(${MONTH_NAME})\\s+(\\d{1,2})\\s*(.*)\\s+(Debit|Credit)\\s*(.*)$`, "i")
      );
      if (!row || /^(Opening|Closing) Balance$/i.test(row[3])) continue;
      const values = moneyValues(row[5]);
      let amountToken = values.length >= 2 ? values.at(-2) : null;
      let lookAheadEnd = index;
      let wrappedDescription = "";
      if (!amountToken && values.length === 1) {
        // Large transfers sometimes wrap the signed amount to the following
        // line, leaving only the running balance on the dated line.
        for (let offset = 1; offset <= 2 && index + offset < page.lines.length; offset += 1) {
          const continuation = cleanText(page.lines[index + offset].text);
          if (/^[+-]$/.test(continuation)) {
            lookAheadEnd = index + offset;
            continue;
          }
          const continuationValues = moneyValues(continuation);
          if (continuationValues.length === 1) {
            amountToken = continuationValues[0];
            lookAheadEnd = index + offset;
            wrappedDescription = normalizeDescription(
              continuation.slice(0, continuationValues[0].index)
            );
          }
          break;
        }
      }
      if (!amountToken) continue;
      const month = MONTHS[row[1].toLowerCase()];
      const year = inferYearForMonth(month, base.periodStart, base.periodEnd);
      const amountValue = Math.abs(amountToken.value);
      let description = normalizeDescription(row[3]);
      if (!description) {
        const previous = cleanText(page.lines[index - 1]?.text ?? "");
        if (previous && !/^[+-]$|^\$?[\d,]*\.\d{2}$|^(?:DATE|Page|capitalone)/i.test(previous)) {
          description = previous;
        }
        if (wrappedDescription) {
          description = normalizeDescription(`${description} ${wrappedDescription}`);
        }
        for (let offset = lookAheadEnd - index + 1; offset <= lookAheadEnd - index + 2; offset += 1) {
          const continuation = cleanText(page.lines[index + offset]?.text ?? "");
          if (!continuation || new RegExp(`^${MONTH_NAME}\\s+\\d{1,2}`, "i").test(continuation)) break;
          if (/^[+-]$|^\$?[\d,]*\.\d{2}$|^(?:Page|capitalone)/i.test(continuation)) continue;
          description = normalizeDescription(`${description} ${continuation}`);
        }
      }
      transactions.push(
        makeTransaction(base, {
          statementAccountKey: currentAccount,
          transactionDate: isoDate(year, month, Number(row[2])),
          amount: row[4].toLowerCase() === "credit" ? amountValue : -amountValue,
          description: description || `${row[4]} transaction`,
          page: page.pageNumber,
          rowReference: `page ${page.pageNumber}, line ${index + 1}`,
          sourceLine: text,
        })
      );
    }
  }
  return transactions;
}

function parseAlly(document, base) {
  const transactions = [];
  let currentAccount = null;
  let pending = null;

  const flush = () => {
    if (!pending) return;
    transactions.push(makeTransaction(base, pending));
    pending = null;
  };

  for (const page of document.pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const line = page.lines[index];
      const text = cleanText(line.text);
      const header = text.match(/^(Spending|Savings) Account Summary/i);
      if (header) {
        flush();
        currentAccount = header[1].toLowerCase() === "spending"
          ? accountKey("ally", "checking", "9448")
          : accountKey("ally", "savings", "9452");
        continue;
      }
      const accountNumber = text.match(/Account Number:\s*x+(\d{4})/i);
      if (accountNumber) {
        currentAccount = accountKey(
          "ally",
          accountNumber[1] === "9448" ? "checking" : "savings",
          accountNumber[1]
        );
        continue;
      }
      if (!currentAccount) continue;

      const dateMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+)$/);
      if (!dateMatch) {
        appendContinuation(pending, line);
        continue;
      }
      flush();
      const values = moneyValues(dateMatch[4]);
      if (values.length < 2) continue;
      const description = normalizeDescription(dateMatch[4].slice(0, values[0].index));
      if (/^(Beginning|Ending) Balance$/i.test(description)) continue;
      const credit = values.at(-3)?.value ?? values.at(-2)?.value ?? 0;
      const debit = values.at(-2)?.value ?? 0;
      let amount = Math.abs(credit) > 0.004 ? Math.abs(credit) : debit;
      if (Math.abs(amount) < 0.005) continue;
      if (Math.abs(credit) <= 0.004 && amount > 0) amount = -amount;
      pending = {
        statementAccountKey: currentAccount,
        transactionDate: numericDate(dateMatch[1], dateMatch[2], dateMatch[3]),
        amount,
        description,
        page: page.pageNumber,
        rowReference: `page ${page.pageNumber}, line ${index + 1}`,
        sourceLine: text,
      };
    }
  }
  flush();
  return transactions;
}

function parseChaseDeposit(document, base) {
  const transactions = [];
  const key = statementAccountFromFolder(base.folder);
  let pending = null;

  const flush = () => {
    if (!pending) return;
    transactions.push(makeTransaction(base, pending));
    pending = null;
  };

  for (const page of document.pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const line = page.lines[index];
      const text = cleanText(line.text);
      if (/^Ending Balance|^\*end\*transaction detail/i.test(text)) {
        flush();
        continue;
      }
      const row = text.match(/^(\d{1,2})\/(\d{1,2})\s+(.+)$/);
      if (!row) {
        if (pending && !/^(?:CHECKING|SAVINGS) SUMMARY|TRANSACTION DETAIL|Beginning Balance|Ending Balance/i.test(text)) {
          appendContinuation(pending, line);
        }
        continue;
      }
      flush();
      const values = moneyValues(row[3]);
      if (values.length === 0) continue;
      const firstMoney = values[0];
      let description = normalizeDescription(row[3].slice(0, firstMoney.index));
      if (/^(Beginning|Ending) Balance$/i.test(description)) continue;
      const amount = firstMoney.value;
      if (!amount) continue;
      const postedMonth = Number(row[1]);
      const postedYear = inferYearForMonth(postedMonth, base.periodStart, base.periodEnd);
      const postedDate = isoDate(postedYear, postedMonth, Number(row[2]));
      const transactionDateMatch = description.match(
        /^(?:(?:Card Purchase|ATM Withdrawal|Card Refund|Debit Card Purchase)\s+)?(\d{1,2})\/(\d{1,2})\s+(.+)$/i
      );
      let transactionDate = postedDate;
      if (transactionDateMatch) {
        const transactionMonth = Number(transactionDateMatch[1]);
        const transactionYear = inferYearForMonth(
          transactionMonth,
          base.periodStart,
          base.periodEnd
        );
        transactionDate = isoDate(
          transactionYear,
          transactionMonth,
          Number(transactionDateMatch[2])
        );
        description = normalizeDescription(transactionDateMatch[3]);
      }
      pending = {
        statementAccountKey: key,
        transactionDate,
        postedDate,
        amount,
        description,
        page: page.pageNumber,
        rowReference: `page ${page.pageNumber}, line ${index + 1}`,
        sourceLine: text,
      };
    }
  }
  flush();
  return transactions;
}

function creditSection(text, current) {
  if (/PAYMENTS? AND (?:OTHER )?CREDITS|PAYMENTS, CREDITS/i.test(text)) return "credit";
  if (/^(?:PURCHASES?|CASH ADVANCES?|ACCOUNT ACTIVITY: PURCHASES)/i.test(text)) return "purchase";
  if (/^(?:FEES CHARGED|INTEREST CHARGED)/i.test(text)) return "purchase";
  if (/^(?:TOTAL PAYMENTS|TOTAL PURCHASES|TOTAL FEES|TOTAL INTEREST)/i.test(text)) return null;
  return current;
}

function parseChaseCredit(document, base) {
  const transactions = [];
  const key = statementAccountFromFolder(base.folder);
  let section = null;
  let pending = null;

  const flush = () => {
    if (!pending) return;
    transactions.push(makeTransaction(base, pending));
    pending = null;
  };

  for (const page of document.pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const line = page.lines[index];
      const text = cleanText(line.text);
      const nextSection = creditSection(text, section);
      if (nextSection !== section || /^(?:TOTAL PAYMENTS|TOTAL PURCHASES|TOTAL FEES|TOTAL INTEREST)/i.test(text)) {
        flush();
        section = nextSection;
        continue;
      }
      if (!section) continue;
      const row = text.match(/^(\d{1,2})\/(\d{1,2})\s+(.+)$/);
      if (!row) {
        if (pending && !/^Date of Transaction|Merchant Name|\$ Amount/i.test(text)) appendContinuation(pending, line);
        continue;
      }
      flush();
      const values = moneyValues(row[3]);
      if (values.length === 0) continue;
      const amountToken = values.at(-1);
      const description = normalizeDescription(row[3].slice(0, amountToken.index));
      if (!description || /^Total/i.test(description)) continue;
      const month = Number(row[1]);
      const year = inferYearForMonth(month, base.periodStart, base.periodEnd);
      pending = {
        statementAccountKey: key,
        transactionDate: isoDate(year, month, Number(row[2])),
        amount:
          amountToken.value < 0 ||
          (section === "credit" && !amountToken.raw.replace(/\s/g, "").startsWith("-"))
            ? Math.abs(amountToken.value)
            : -Math.abs(amountToken.value),
        description,
        page: page.pageNumber,
        rowReference: `page ${page.pageNumber}, line ${index + 1}`,
        sourceLine: text,
      };
    }
  }
  flush();
  return transactions;
}

function parseCapitalOneCredit(document, base) {
  const transactions = [];
  const key = statementAccountFromFolder(base.folder);
  let section = null;
  let pending = null;

  const flush = () => {
    if (!pending) return;
    transactions.push(makeTransaction(base, pending));
    pending = null;
  };

  for (const page of document.pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const line = page.lines[index];
      const text = cleanText(line.text);
      if (/Payments, Credits and Adjustments/i.test(text)) {
        flush();
        section = "credit";
        continue;
      }
      if (/: Transactions$/i.test(text) || /^Transactions\s+Trans Date/i.test(text)) {
        flush();
        section = "purchase";
        continue;
      }
      if (/^Fees\s*$/i.test(text)) {
        flush();
        section = "purchase";
        continue;
      }
      if (/^Interest Charged\s*$/i.test(text)) {
        flush();
        section = "interest";
        continue;
      }
      if (/^(?:Total Transactions|Totals Year-to-Date)/i.test(text)) {
        flush();
        section = null;
        continue;
      }
      if (!section) continue;

      if (section === "interest") {
        const interestRow = text.match(/^(Interest Charge on .+?)\s+(\$?[\d,]*\.\d{2})$/i);
        if (interestRow) {
          const amount = Math.abs(parseMoney(interestRow[2]));
          if (amount > 0.004) {
            transactions.push(
              makeTransaction(base, {
                statementAccountKey: key,
                transactionDate: base.periodEnd,
                postedDate: base.periodEnd,
                amount: -amount,
                description: interestRow[1],
                page: page.pageNumber,
                rowReference: `page ${page.pageNumber}, line ${index + 1}`,
                sourceLine: text,
              })
            );
          }
        }
        continue;
      }

      if (/Total Transactions|Total Fees|Total Interest|Totals Year-to-Date/i.test(text)) {
        flush();
        section = null;
        continue;
      }

      const row = text.match(
        new RegExp(`^(${MONTH_NAME})\\s+(\\d{1,2})\\s+(${MONTH_NAME})\\s+(\\d{1,2})\\s+(.+)$`, "i")
      );
      if (!row) {
        appendContinuation(pending, line);
        continue;
      }
      flush();
      const values = moneyValues(row[5]);
      if (values.length === 0) continue;
      const amountToken = values.at(-1);
      const description = normalizeDescription(row[5].slice(0, amountToken.index));
      const transactionMonth = MONTHS[row[1].toLowerCase()];
      const postedMonth = MONTHS[row[3].toLowerCase()];
      const transactionYear = inferYearForMonth(transactionMonth, base.periodStart, base.periodEnd);
      const postedYear = inferYearForMonth(postedMonth, base.periodStart, base.periodEnd);
      pending = {
        statementAccountKey: key,
        transactionDate: isoDate(transactionYear, transactionMonth, Number(row[2])),
        postedDate: isoDate(postedYear, postedMonth, Number(row[4])),
        amount:
          amountToken.value < 0 ||
          (section === "credit" && !amountToken.raw.replace(/\s/g, "").startsWith("-"))
            ? Math.abs(amountToken.value)
            : -Math.abs(amountToken.value),
        description,
        page: page.pageNumber,
        rowReference: `page ${page.pageNumber}, line ${index + 1}`,
        sourceLine: text,
      };
    }
  }
  flush();
  return transactions;
}

function parseGrasshopper(document, base) {
  const transactions = [];
  const key = statementAccountFromFolder(base.folder);
  let inDetail = false;
  let pending = null;

  const flush = () => {
    if (!pending) return;
    transactions.push(makeTransaction(base, pending));
    pending = null;
  };

  for (const page of document.pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const line = page.lines[index];
      const text = cleanText(line.text)
        .replace(/^(?:[A-Z]{16,}|\d{4}\s+\d{7}\s+\d{4}-\d{4}[^A-Za-z]*)\s*/g, "")
        .trim();
      if (/^Transaction Detail$/i.test(text)) {
        inDetail = true;
        continue;
      }
      if (/^(?:Debits|Credits)(?: \(Continued\))?$/i.test(text)) {
        flush();
        inDetail = true;
        continue;
      }
      if (/^(?:Earnings Summary|Overdraft\\?Return Item Fees)/i.test(text)) {
        flush();
        inDetail = false;
        continue;
      }
      if (!inDetail) continue;
      const row = text.match(new RegExp(`(?:^|\\s)(${MONTH_NAME})\\s+(\\d{1,2})\\s+(.+)$`, "i"));
      if (!row) {
        if (text && !/^[A-Z]{12,}$/.test(text)) appendContinuation(pending, { ...line, text });
        continue;
      }
      flush();
      const values = moneyValues(row[3]);
      if (values.length === 0) continue;
      const description = normalizeDescription(row[3].slice(0, values[0].index));
      if (/^(Beginning|Ending) Balance$/i.test(description)) continue;
      const amountToken = values[0];
      const month = MONTHS[row[1].toLowerCase()];
      const year = inferYearForMonth(month, base.periodStart, base.periodEnd);
      let amount = amountToken.value;
      if (amount > 0 && /PURCHASE|WITHDRAW|DEBIT|FEE/i.test(description)) amount = -amount;
      pending = {
        statementAccountKey: key,
        transactionDate: isoDate(year, month, Number(row[2])),
        amount,
        description,
        page: page.pageNumber,
        rowReference: `page ${page.pageNumber}, line ${index + 1}`,
        sourceLine: text,
      };
    }
  }
  flush();
  return transactions;
}

function dedupeWithinFile(transactions) {
  const counts = new Map();
  for (const transaction of transactions) {
    const key = [
      transaction.statementAccountKey,
      transaction.transactionDate,
      transaction.postedDate ?? "",
      transaction.amount.toFixed(2),
      transaction.normalizedDescription,
    ].join("|");
    const occurrence = (counts.get(key) ?? 0) + 1;
    counts.set(key, occurrence);
    transaction.sourceOccurrence = occurrence;
  }
  return transactions;
}

function roundedMoney(value) {
  return Math.round(value * 100) / 100;
}

function sumForAccount(transactions, statementAccountKey) {
  return roundedMoney(
    transactions
      .filter((transaction) => transaction.statementAccountKey === statementAccountKey)
      .reduce((sum, transaction) => sum + transaction.amount, 0)
  );
}

function validationRow(statementAccountKey, expectedNet, parsedNet, method) {
  const delta = roundedMoney(parsedNet - expectedNet);
  return {
    statementAccountKey,
    method,
    expectedNet: roundedMoney(expectedNet),
    parsedNet: roundedMoney(parsedNet),
    delta,
    status: Math.abs(delta) <= 0.02 ? "pass" : "fail",
  };
}

function firstMoneyAfter(text, pattern) {
  const match = text.match(pattern);
  return match ? parseMoney(match[1]) : null;
}

function validateSingleDeposit(document, base, transactions, statementAccountKey) {
  const beginning = firstMoneyAfter(
    document.text,
    /Beginning Balance(?: as of [^$\n]+)?\s+(\$[\d,]+\.\d{2})/i
  );
  const ending = firstMoneyAfter(
    document.text,
    /Ending Balance(?: as of [^$\n]+)?\s+(\$[\d,]+\.\d{2})/i
  );
  if (beginning === null || ending === null) return [];
  return [
    validationRow(
      statementAccountKey,
      ending - beginning,
      sumForAccount(transactions, statementAccountKey),
      "ending_balance_minus_beginning_balance"
    ),
  ];
}

function validateCreditCard(document, base, transactions, statementAccountKey) {
  const text = document.pages[0]?.text ?? document.text;
  if (base.parser === "chase_credit_card") {
    const credits = firstMoneyAfter(
      text,
      /^Payment,?\s*Credits\s*(?:-\s*)?(\$[\d,]+\.\d{2})/im
    );
    const purchases = firstMoneyAfter(text, /^Purchases\s*(?:\+\s*)?(\$[\d,]+\.\d{2})/im);
    const cashAdvances =
      firstMoneyAfter(text, /^Cash Advances\s*(?:\+\s*)?(\$[\d,]+\.\d{2})/im) ?? 0;
    const fees = firstMoneyAfter(text, /^Fees Charged\s*\+?\s*(\$[\d,]+\.\d{2})/im) ?? 0;
    const interest =
      firstMoneyAfter(text, /^Interest Charged\s*\+?\s*(\$[\d,]+\.\d{2})/im) ?? 0;
    if (credits === null || purchases === null) return [];
    return [
      validationRow(
        statementAccountKey,
        Math.abs(credits) - Math.abs(purchases) - Math.abs(cashAdvances) - Math.abs(fees) - Math.abs(interest),
        sumForAccount(transactions, statementAccountKey),
        "credit_card_activity_summary"
      ),
    ];
  }

  const payments = firstMoneyAfter(text, /Payments\s*(?:-\s*)?(\$[\d,]+\.\d{2})/i);
  const otherCredits =
    firstMoneyAfter(text, /Other Credits\s*(?:-\s*)?(\$[\d,]+\.\d{2})/i) ?? 0;
  const purchases = firstMoneyAfter(text, /Transactions\s*\+\s*(\$[\d,]+\.\d{2})/i);
  const cashAdvances =
    firstMoneyAfter(text, /Cash Advances\s*\+\s*(\$[\d,]+\.\d{2})/i) ?? 0;
  const fees = firstMoneyAfter(text, /Fees Charged\s*\+\s*(\$[\d,]+\.\d{2})/i) ?? 0;
  const interest =
    firstMoneyAfter(text, /Interest Charged\s*\+\s*(\$[\d,]+\.\d{2})/i) ?? 0;
  if (payments === null || purchases === null) return [];
  return [
    validationRow(
      statementAccountKey,
      Math.abs(payments) + Math.abs(otherCredits) - Math.abs(purchases) - Math.abs(cashAdvances) - Math.abs(fees) - Math.abs(interest),
      sumForAccount(transactions, statementAccountKey),
      "credit_card_activity_summary"
    ),
  ];
}

function validateCapitalOneCombined(document, transactions) {
  const balances = new Map();
  let currentAccount = null;

  // Account sections can start at the bottom of one page and continue on the
  // next, so page-scoped matching can associate the next account with the
  // previous account's balances. Walk the statement in reading order instead.
  for (const page of document.pages) {
    for (const line of page.lines) {
      const text = cleanText(line.text);
      const header = text.match(/^(Cap1 Check|360 Performance Savings).*?(\d{4})\s*$/i);
      if (header) {
        currentAccount = header[1].toLowerCase().includes("saving")
          ? accountKey("capital_one", "savings", header[2])
          : accountKey("capital_one", "checking", header[2]);
        if (!balances.has(currentAccount)) balances.set(currentAccount, {});
        continue;
      }
      if (!currentAccount) continue;
      const opening = text.match(/Opening Balance\s+(\$[\d,]+\.\d{2})/i);
      const closing = text.match(/Closing Balance\s+(\$[\d,]+\.\d{2})/i);
      if (opening) balances.get(currentAccount).beginning = parseMoney(opening[1]);
      if (closing) balances.get(currentAccount).ending = parseMoney(closing[1]);
    }
  }

  return [...balances.entries()].flatMap(([statementAccountKey, balance]) => {
    if (balance.beginning === undefined || balance.ending === undefined) return [];
    return [
      validationRow(
        statementAccountKey,
        balance.ending - balance.beginning,
        sumForAccount(transactions, statementAccountKey),
        "ending_balance_minus_beginning_balance"
      ),
    ];
  });
}

function validateAllyCombined(document, transactions) {
  const results = [];
  for (const page of document.pages) {
    const last4 = page.text.match(/Account Number:\s*x+(\d{4})/i)?.[1];
    if (!last4 || !["9448", "9452"].includes(last4)) continue;
    const statementAccountKey = accountKey(
      "ally",
      last4 === "9448" ? "checking" : "savings",
      last4
    );
    const beginning = firstMoneyAfter(
      page.text,
      /Beginning Balance,?\s*as of [^$\n]+\s*(\$[\d,]+\.\d{2})/i
    );
    const ending = firstMoneyAfter(
      page.text,
      /Ending Balance,?\s*as of [^$\n]+\s*(\$[\d,]+\.\d{2})/i
    );
    if (beginning === null || ending === null) continue;
    results.push(
      validationRow(
        statementAccountKey,
        ending - beginning,
        sumForAccount(transactions, statementAccountKey),
        "ending_balance_minus_beginning_balance"
      )
    );
  }
  return results;
}

function validateParsedTransactions(document, base, transactions) {
  const defaultKey = statementAccountFromFolder(base.folder);
  if (base.parser === "capital_one_combined_deposit") {
    return validateCapitalOneCombined(document, transactions);
  }
  if (base.parser === "ally_combined_deposit") {
    return validateAllyCombined(document, transactions);
  }
  if (
    base.parser === "chase_credit_card" ||
    base.parser === "capital_one_credit_card"
  ) {
    return defaultKey ? validateCreditCard(document, base, transactions, defaultKey) : [];
  }
  if (base.parser === "chase_deposit" || base.parser === "grasshopper_deposit") {
    return defaultKey ? validateSingleDeposit(document, base, transactions, defaultKey) : [];
  }
  return [];
}

export async function extractPdfDocument(filePath) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(await fs.readFile(filePath));
  const pdf = await getDocument({ data: bytes, useSystemFonts: true }).promise;
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items
        .filter((item) => "str" in item && "transform" in item && item.str.trim())
        .map((item) => ({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width ?? 0,
        }));
      const grouped = [];
      for (const item of items) {
        let row = grouped.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
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
            text: cleanText(sorted.map((item) => item.text).join(" ")),
            y: row.y,
            xMin: Math.min(...sorted.map((item) => item.x)),
            xMax: Math.max(...sorted.map((item) => item.x + item.width)),
            items: sorted,
          };
        })
        .filter((line) => line.text);
      pages.push({ pageNumber, lines, text: lines.map((line) => line.text).join("\n") });
    }
  } finally {
    await pdf.destroy();
  }
  return { pageCount: pages.length, pages, text: pages.map((page) => page.text).join("\n") };
}

export async function parseStatementFile(filePath, statementsRoot) {
  const document = await extractPdfDocument(filePath);
  const relativePath = path.relative(statementsRoot, filePath).replaceAll("\\", "/");
  const folder = path.basename(path.dirname(filePath));
  const parser = detectParser(folder, document.text);
  const period = parsePeriod(document.text);
  const fileHash = sha256(await fs.readFile(filePath));
  const base = {
    relativePath,
    folder,
    parser,
    periodStart: period.start,
    periodEnd: period.end,
  };

  let transactions = [];
  if (parser === "ally_combined_deposit") transactions = parseAlly(document, base);
  if (parser === "capital_one_combined_deposit") transactions = parseCapitalOneDeposit(document, base);
  if (parser === "chase_deposit") transactions = parseChaseDeposit(document, base);
  if (parser === "chase_credit_card") transactions = parseChaseCredit(document, base);
  if (parser === "capital_one_credit_card") transactions = parseCapitalOneCredit(document, base);
  if (parser === "grasshopper_deposit") transactions = parseGrasshopper(document, base);

  transactions = dedupeWithinFile(transactions);
  const validations = validateParsedTransactions(document, base, transactions);

  const warnings = [];
  if (!period.start || !period.end) warnings.push("statement_period_not_detected");
  if (parser === "unknown") warnings.push("unsupported_statement_format");
  if (
    transactions.length === 0 &&
    !validations.some(
      (validation) => validation.status === "pass" && Math.abs(validation.expectedNet) <= 0.02
    )
  ) {
    warnings.push("no_transactions_parsed");
  }
  if (validations.some((validation) => validation.status === "fail")) {
    warnings.push("statement_balance_validation_failed");
  }
  if (validations.length === 0) warnings.push("statement_balance_not_validated");

  const defaultAccountKey = statementAccountFromFolder(folder);
  const detectedAccountLast4s = new Set();
  for (const pattern of [
    /Account Number:\s*x+(\d{4})/gi,
    /^Account ending in\s+(\d{4})\s*$/gim,
    /Payment Due Date:[^\n]*?Account ending in\s+(\d{4})/gi,
    /Account Number:\s*(?:\d{4}|X{4})\s+(?:\d{4}|X{4})\s+(?:\d{4}|X{4})\s+(\d{4})/gi,
  ]) {
    for (const match of document.text.matchAll(pattern)) detectedAccountLast4s.add(match[1]);
  }
  const statementAccountKeys =
    parser === "ally_combined_deposit"
      ? [accountKey("ally", "checking", "9448"), accountKey("ally", "savings", "9452")]
      : parser === "capital_one_combined_deposit"
        ? [
            accountKey("capital_one", "checking", "3244"),
            accountKey("capital_one", "savings", "0580"),
          ]
        : defaultAccountKey
          ? [defaultAccountKey]
          : [...new Set(transactions.map((transaction) => transaction.statementAccountKey))];

  return {
    relativePath,
    folder,
    fileHash,
    pageCount: document.pageCount,
    parser,
    periodStart: period.start,
    periodEnd: period.end,
    statementAccountKeys,
    detectedAccountLast4s: [...detectedAccountLast4s].sort(),
    transactions,
    validations,
    warnings,
  };
}

export function descriptionForMatching(value) {
  return normalizedMatchDescription(value ?? "");
}

export function stableHash(value) {
  return sha256(value);
}
