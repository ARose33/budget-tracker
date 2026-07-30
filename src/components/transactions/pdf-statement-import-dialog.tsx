"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileCheck2, FileText, Plus, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AccountSelect } from "@/components/transactions/account-select";
import { getAccounts, type Account } from "@/lib/queries/accounts";
import { getCurrentUserId } from "@/lib/supabase/auth";
import { supabase } from "@/lib/supabase/client";

interface PdfStatementImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

interface QueuedFile {
  id: string;
  file: File;
  accountId: string;
}

interface ReviewRow {
  id: string;
  fileName: string;
  accountId: string;
  accountName: string;
  date: string;
  description: string;
  amount: number;
  confidence: "high" | "medium";
  selected: boolean;
  isDuplicate: boolean;
}

interface ParseResponse {
  fileName: string;
  transactions: Array<{
    date: string;
    description: string;
    amount: number;
    confidence: "high" | "medium";
  }>;
  excludedOutsideTargetYear: number;
  warnings: string[];
  error?: string;
}

type Step = "upload" | "parsing" | "review" | "importing";

function accountTypeHint(account: Account) {
  if (account.type === "Credit Card") return "credit_card";
  if (account.type === "Savings") return "savings";
  return "checking";
}

function institutionHint(account: Account) {
  const institution = account.institution.toLowerCase();
  if (institution.includes("ally")) return "ally";
  if (institution.includes("capital one")) return "capital_one";
  if (institution.includes("chase")) return "chase";
  if (institution.includes("sofi")) return "sofi";
  return "unknown";
}

function duplicateKey(row: {
  accountId: string;
  date: string;
  amount: number;
  description: string | null;
}) {
  const description = (row.description ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 24);
  return `${row.accountId}|${row.date}|${Number(row.amount).toFixed(2)}|${description}`;
}

async function parseOneStatement(queued: QueuedFile, account: Account) {
  const formData = new FormData();
  formData.set("file", queued.file);
  formData.set("accountType", accountTypeHint(account));
  formData.set("institution", institutionHint(account));

  const response = await fetch("/api/statements/parse", {
    method: "POST",
    body: formData,
  });
  const result = (await response.json()) as ParseResponse;
  if (!response.ok) throw new Error(result.error || `Could not parse ${queued.file.name}`);
  return result;
}

export function PdfStatementImportDialog({
  open,
  onOpenChange,
  onComplete,
}: PdfStatementImportDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [excludedCount, setExcludedCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload");
    setAccountId(null);
    setQueuedFiles([]);
    setReviewRows([]);
    setWarnings([]);
    setExcludedCount(0);
  };

  const selectedRows = useMemo(
    () => reviewRows.filter((row) => row.selected && !row.isDuplicate),
    [reviewRows]
  );
  const duplicateCount = reviewRows.filter((row) => row.isDuplicate).length;
  const mediumConfidenceCount = reviewRows.filter(
    (row) => row.confidence === "medium"
  ).length;

  const addFiles = (files: FileList | null) => {
    if (!accountId) {
      toast.error("Choose the account these statements belong to first");
      return;
    }
    const pdfs = [...(files ?? [])].filter(
      (file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
    );
    if (pdfs.length === 0) return;
    setQueuedFiles((current) => [
      ...current,
      ...pdfs.map((file) => ({
        id: crypto.randomUUID(),
        file,
        accountId,
      })),
    ]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleParse = async () => {
    if (queuedFiles.length === 0) {
      toast.error("Add at least one statement");
      return;
    }
    setStep("parsing");

    try {
      const accounts = await getAccounts();
      const accountMap = new Map(accounts.map((account) => [account.id, account]));
      const parsed: Array<{ queued: QueuedFile; account: Account; result: ParseResponse }> = [];

      // Keep concurrency modest so a full year of statements does not overwhelm the server.
      for (let index = 0; index < queuedFiles.length; index += 3) {
        const batch = queuedFiles.slice(index, index + 3);
        const results = await Promise.all(
          batch.map(async (queued) => {
            const account = accountMap.get(queued.accountId);
            if (!account) throw new Error(`Account not found for ${queued.file.name}`);
            return { queued, account, result: await parseOneStatement(queued, account) };
          })
        );
        parsed.push(...results);
      }

      const rows: ReviewRow[] = parsed.flatMap(({ queued, account, result }) =>
        result.transactions.map((transaction, index) => ({
          id: `${queued.id}-${index}`,
          fileName: queued.file.name,
          accountId: account.id,
          accountName: account.name,
          date: transaction.date,
          description: transaction.description,
          amount: transaction.amount,
          confidence: transaction.confidence,
          selected: true,
          isDuplicate: false,
        }))
      );

      const userId = await getCurrentUserId();
      const { data: existing, error } = await supabase
        .from("transactions")
        .select("account_id, date, amount, description")
        .eq("user_id", userId)
        .gte("date", "2023-01-01")
        .lte("date", "2023-12-31");
      if (error) throw error;
      const existingKeys = new Set(
        (existing ?? [])
          .filter((row) => row.account_id)
          .map((row) =>
            duplicateKey({
              accountId: row.account_id!,
              date: row.date,
              amount: row.amount,
              description: row.description,
            })
          )
      );
      const seen = new Set<string>();
      const checkedRows = rows.map((row) => {
        const key = duplicateKey(row);
        const isDuplicate = existingKeys.has(key) || seen.has(key);
        seen.add(key);
        return { ...row, isDuplicate, selected: !isDuplicate };
      });

      setReviewRows(checkedRows);
      setWarnings([...new Set(parsed.flatMap(({ result }) => result.warnings))]);
      setExcludedCount(
        parsed.reduce((total, { result }) => total + result.excludedOutsideTargetYear, 0)
      );
      setStep("review");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not parse statements");
      setStep("upload");
    }
  };

  const handleImport = async () => {
    if (selectedRows.length === 0) {
      toast.warning("Select at least one new transaction");
      return;
    }
    setStep("importing");
    try {
      const userId = await getCurrentUserId();
      const accounts = await getAccounts();
      const accountMap = new Map(accounts.map((account) => [account.id, account]));
      const inserts = selectedRows.map((row) => ({
        date: row.date,
        description: row.description,
        amount: row.amount,
        account_id: row.accountId,
        account: accountMap.get(row.accountId)?.name ?? row.accountName,
        status: "Unconfirmed",
        source: "statement_pdf",
        upload_source: `pdf_statement:${row.fileName}`.slice(0, 250),
        connection_provider: "manual",
        not_duplicate: false,
        user_id: userId,
      }));

      for (let index = 0; index < inserts.length; index += 500) {
        const { error } = await supabase
          .from("transactions")
          .insert(inserts.slice(index, index + 500));
        if (error) throw error;
      }

      toast.success(`Imported ${inserts.length} transactions from 2023`);
      reset();
      onOpenChange(false);
      onComplete();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
      setStep("review");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && step !== "parsing" && step !== "importing") reset();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import 2023 PDF statements</DialogTitle>
          <DialogDescription>
            Add each account&apos;s monthly statements in a batch. January 2024 is accepted,
            but only transactions dated in 2023 will be imported.
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-5">
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="mb-3 text-sm font-medium">1. Choose an account</p>
              <AccountSelect
                value={accountId}
                onValueChange={setAccountId}
                className="w-full sm:w-[420px]"
                placeholder="Choose checking, savings, or credit card"
              />
              <p className="mb-3 mt-5 text-sm font-medium">2. Add its PDF statements</p>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  multiple
                  onChange={(event) => addFiles(event.target.files)}
                  className="max-w-md"
                />
                <span className="text-xs text-muted-foreground">15 MB max per file</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Repeat these two steps for Ally, Capital One, Chase, and SoFi. PDFs are
                read for this import and are not saved.
              </p>
            </div>

            {queuedFiles.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {queuedFiles.length} statement{queuedFiles.length === 1 ? "" : "s"} ready
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => setQueuedFiles([])}>
                    Clear all
                  </Button>
                </div>
                <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                  {queuedFiles.map((queued) => (
                    <div key={queued.id} className="flex items-center gap-3 p-3">
                      <FileText className="size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{queued.file.name}</span>
                      <div className="w-64">
                        <AccountSelect
                          value={queued.accountId}
                          onValueChange={(nextAccountId) =>
                            setQueuedFiles((current) =>
                              current.map((item) =>
                                item.id === queued.id
                                  ? { ...item, accountId: nextAccountId }
                                  : item
                              )
                            )
                          }
                          className="w-full"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${queued.file.name}`}
                        onClick={() =>
                          setQueuedFiles((current) =>
                            current.filter((item) => item.id !== queued.id)
                          )
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={queuedFiles.length === 0} onClick={handleParse}>
                <Upload />
                Parse {queuedFiles.length || ""} statement{queuedFiles.length === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {(step === "parsing" || step === "importing") && (
          <div className="flex flex-col items-center gap-4 py-16">
            <div className="size-9 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">
              {step === "parsing"
                ? `Reading ${queuedFiles.length} statement${queuedFiles.length === 1 ? "" : "s"}…`
                : `Importing ${selectedRows.length} transactions…`}
            </p>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{reviewRows.length} parsed</Badge>
              <Badge>{selectedRows.length} ready to import</Badge>
              {duplicateCount > 0 && (
                <Badge variant="outline">{duplicateCount} duplicates skipped</Badge>
              )}
              {excludedCount > 0 && (
                <Badge variant="outline">{excludedCount} non-2023 rows excluded</Badge>
              )}
              {mediumConfidenceCount > 0 && (
                <Badge variant="outline" className="border-amber-300 text-amber-700">
                  <AlertTriangle />
                  {mediumConfidenceCount} need amount review
                </Badge>
              )}
            </div>

            {warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}

            <div className="max-h-[430px] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="w-10 p-2">
                      <Checkbox
                        checked={
                          reviewRows.length > 0 &&
                          reviewRows
                            .filter((row) => !row.isDuplicate)
                            .every((row) => row.selected)
                        }
                        onCheckedChange={(checked) =>
                          setReviewRows((current) =>
                            current.map((row) => ({
                              ...row,
                              selected: row.isDuplicate ? false : checked === true,
                            }))
                          )
                        }
                      />
                    </th>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Description</th>
                    <th className="p-2 text-left">Account</th>
                    <th className="p-2 text-right">Amount</th>
                    <th className="p-2 text-left">Statement</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewRows.map((row) => (
                    <tr
                      key={row.id}
                      className={
                        row.isDuplicate
                          ? "border-t opacity-45"
                          : row.confidence === "medium"
                            ? "border-t bg-amber-50/60"
                            : "border-t"
                      }
                    >
                      <td className="p-2">
                        <Checkbox
                          checked={row.selected}
                          disabled={row.isDuplicate}
                          onCheckedChange={(checked) =>
                            setReviewRows((current) =>
                              current.map((item) =>
                                item.id === row.id
                                  ? { ...item, selected: checked === true }
                                  : item
                              )
                            )
                          }
                        />
                      </td>
                      <td className="whitespace-nowrap p-2">{row.date}</td>
                      <td className="max-w-sm p-2">
                        <span className="line-clamp-2">{row.description}</span>
                      </td>
                      <td className="whitespace-nowrap p-2">{row.accountName}</td>
                      <td className="whitespace-nowrap p-2 text-right">
                        <button
                          type="button"
                          className={`rounded px-1 py-0.5 hover:bg-muted ${
                            row.amount > 0 ? "text-emerald-700" : ""
                          }`}
                          title="Click to switch between money in and money out"
                          onClick={() =>
                            setReviewRows((current) =>
                              current.map((item) =>
                                item.id === row.id
                                  ? {
                                      ...item,
                                      amount: item.amount * -1,
                                      isDuplicate: false,
                                      selected: true,
                                    }
                                  : item
                              )
                            )
                          }
                        >
                          {row.amount < 0 ? "-" : ""}
                          ${Math.abs(row.amount).toFixed(2)}
                        </button>
                      </td>
                      <td className="max-w-44 truncate p-2 text-xs text-muted-foreground">
                        {row.isDuplicate ? "Already imported" : row.fileName}
                      </td>
                    </tr>
                  ))}
                  {reviewRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-10 text-center text-muted-foreground">
                        No 2023 transactions were recognized. Check the warnings above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              Negative amounts are spending; positive amounts are deposits, refunds, or
              card payments. Click an amount to switch its sign, or uncheck a row to skip it.
            </p>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("upload")}>
                <Plus />
                Adjust statements
              </Button>
              <Button disabled={selectedRows.length === 0} onClick={handleImport}>
                <FileCheck2 />
                Import {selectedRows.length} transactions
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
