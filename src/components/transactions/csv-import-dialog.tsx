"use client";

import { useState, useCallback } from "react";
import Papa from "papaparse";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Upload, FileText, AlertTriangle } from "lucide-react";

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

type Step = "upload" | "map" | "preview" | "importing";

interface ColumnMapping {
  date: string;
  description: string;
  amount: string;
}

interface ParsedRow {
  date: string;
  description: string;
  amount: number;
  isDuplicate?: boolean;
}

export function CsvImportDialog({
  open,
  onOpenChange,
  onComplete,
}: CsvImportDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [rawData, setRawData] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    date: "",
    description: "",
    amount: "",
  });
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [duplicateCount, setDuplicateCount] = useState(0);

  const reset = () => {
    setStep("upload");
    setRawData([]);
    setHeaders([]);
    setMapping({ date: "", description: "", amount: "" });
    setParsedRows([]);
    setDuplicateCount(0);
  };

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as Record<string, string>[];
        const cols = results.meta.fields || [];
        setRawData(data);
        setHeaders(cols);

        // Auto-detect common column names
        const autoMap: ColumnMapping = { date: "", description: "", amount: "" };
        for (const col of cols) {
          const lower = col.toLowerCase();
          if (
            lower.includes("date") ||
            lower === "posted date" ||
            lower === "transaction date"
          )
            autoMap.date = col;
          if (
            lower.includes("description") ||
            lower.includes("merchant") ||
            lower === "name" ||
            lower === "memo"
          )
            autoMap.description = col;
          if (
            lower === "amount" ||
            lower === "debit" ||
            lower.includes("amount")
          )
            autoMap.amount = col;
        }
        setMapping(autoMap);
        setStep("map");
      },
    });
  }, []);

  const handleMap = async () => {
    if (!mapping.date || !mapping.description || !mapping.amount) {
      toast.error("Please map all required columns");
      return;
    }

    const rows: ParsedRow[] = rawData
      .map((row) => {
        const rawAmount = row[mapping.amount]?.replace(/[$,]/g, "");
        const amount = parseFloat(rawAmount);
        const rawDate = row[mapping.date];
        // Try to parse the date
        const d = new Date(rawDate);
        const dateStr = isNaN(d.getTime())
          ? rawDate
          : d.toISOString().split("T")[0];

        return {
          date: dateStr,
          description: row[mapping.description] || "",
          amount: isNaN(amount) ? 0 : amount,
        };
      })
      .filter((r) => r.amount !== 0 && r.date);

    // Check for duplicates
    const dupeChecks = await Promise.all(
      rows.map(async (r) => {
        const { count } = await supabase
          .from("transactions")
          .select("*", { count: "exact", head: true })
          .eq("date", r.date)
          .eq("amount", r.amount)
          .ilike("description", `%${r.description.slice(0, 20)}%`);

        return { ...r, isDuplicate: (count ?? 0) > 0 };
      })
    );

    const dupes = dupeChecks.filter((r) => r.isDuplicate).length;
    setDuplicateCount(dupes);
    setParsedRows(dupeChecks);
    setStep("preview");
  };

  const handleImport = async () => {
    setStep("importing");
    const nonDupes = parsedRows.filter((r) => !r.isDuplicate);

    if (nonDupes.length === 0) {
      toast.warning("No new transactions to import (all duplicates)");
      reset();
      onOpenChange(false);
      return;
    }

    const insertRows = nonDupes.map((r) => ({
      date: r.date,
      description: r.description,
      amount: r.amount,
      upload_source: "csv_import",
      status: "Unconfirmed",
    }));

    const { error } = await supabase.from("transactions").insert(insertRows);

    if (error) {
      toast.error("Import failed: " + error.message);
      setStep("preview");
      return;
    }

    toast.success(`Imported ${nonDupes.length} transactions`);
    reset();
    onOpenChange(false);
    onComplete();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "upload" && "Import CSV"}
            {step === "map" && "Map Columns"}
            {step === "preview" && "Preview Import"}
            {step === "importing" && "Importing..."}
          </DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Upload className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Upload a CSV file from your bank
            </p>
            <Input
              type="file"
              accept=".csv"
              onChange={handleFile}
              className="max-w-xs"
            />
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Found {rawData.length} rows. Map the columns:
            </p>
            {(["date", "description", "amount"] as const).map((field) => (
              <div key={field} className="flex items-center gap-3">
                <label className="text-sm font-medium w-28 capitalize">
                  {field}
                </label>
                <Select
                  value={mapping[field]}
                  onValueChange={(v) =>
                    setMapping((m) => ({ ...m, [field]: v }))
                  }
                >
                  <SelectTrigger className="w-[250px]">
                    <SelectValue placeholder="Select column" />
                  </SelectTrigger>
                  <SelectContent>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button onClick={handleMap}>Preview</Button>
            </DialogFooter>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge variant="secondary">
                {parsedRows.length} transactions
              </Badge>
              {duplicateCount > 0 && (
                <Badge variant="outline" className="border-yellow-300 text-yellow-700">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {duplicateCount} duplicates (will be skipped)
                </Badge>
              )}
              <Badge variant="default">
                {parsedRows.length - duplicateCount} to import
              </Badge>
            </div>
            <div className="max-h-[300px] overflow-y-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Description</th>
                    <th className="text-right p-2">Amount</th>
                    <th className="text-center p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 100).map((row, i) => (
                    <tr
                      key={i}
                      className={row.isDuplicate ? "opacity-40" : ""}
                    >
                      <td className="p-2">{row.date}</td>
                      <td className="p-2 truncate max-w-[200px]">
                        {row.description}
                      </td>
                      <td className="p-2 text-right">
                        ${Math.abs(row.amount).toFixed(2)}
                      </td>
                      <td className="p-2 text-center">
                        {row.isDuplicate ? (
                          <Badge variant="outline" className="text-yellow-600">
                            Dupe
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-emerald-600">
                            New
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 100 && (
                <p className="p-2 text-center text-xs text-muted-foreground">
                  Showing first 100 of {parsedRows.length}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("map")}>
                Back
              </Button>
              <Button onClick={handleImport}>
                <FileText className="h-4 w-4 mr-1" />
                Import {parsedRows.length - duplicateCount} Transactions
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "importing" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">
              Importing transactions...
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
