import test from "node:test";
import assert from "node:assert/strict";
import { parseStatementText } from "./parser.ts";

test("parses Chase credit-card purchases, payments, and excludes 2024", () => {
  const result = parseStatementText(
    [
      "CHASE Freedom Unlimited",
      "Opening/Closing Date 12/15/23 - 01/14/24",
      "12/20 12/21 KING SOOPERS #1234 54.32",
      "12/27 12/28 PAYMENT THANK YOU 1,000.00",
      "01/02 01/03 COFFEE SHOP 7.50",
    ],
    { targetYear: 2023, accountTypeHint: "credit_card" }
  );

  assert.deepEqual(
    result.transactions.map(({ date, description, amount }) => ({
      date,
      description,
      amount,
    })),
    [
      { date: "2023-12-20", description: "KING SOOPERS #1234", amount: -54.32 },
      { date: "2023-12-27", description: "PAYMENT THANK YOU", amount: 1000 },
    ]
  );
  assert.equal(result.excludedOutsideTargetYear, 1);
});

test("parses bank rows with transaction amount and running balance", () => {
  const result = parseStatementText(
    [
      "Ally Bank Spending Account Statement 2023",
      "01/03/2023 DIRECT DEP EMPLOYER $2,500.00 $4,100.00",
      "01/05/2023 DEBIT CARD GROCERY $82.14 $4,017.86",
    ],
    { targetYear: 2023, accountTypeHint: "checking" }
  );

  assert.deepEqual(
    result.transactions.map((row) => row.amount),
    [2500, -82.14]
  );
});

test("uses the prior year for December rows in a January statement", () => {
  const result = parseStatementText(
    [
      "Capital One Quicksilver Statement January 2024",
      "Dec 29 Dec 30 BOOK STORE $25.00",
      "Jan 02 Jan 03 RESTAURANT $18.00",
    ],
    { targetYear: 2023, accountTypeHint: "credit_card" }
  );

  assert.deepEqual(
    result.transactions.map((row) => row.date),
    ["2023-12-29"]
  );
  assert.equal(result.excludedOutsideTargetYear, 1);
});
