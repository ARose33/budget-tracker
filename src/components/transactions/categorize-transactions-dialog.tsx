"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { categorizeNextTransactions } from "@/lib/queries/transactions";

interface CategorizeTransactionsDialogProps {
  uncategorizedCount: number;
}

interface CategorizationProgress {
  total: number;
  processed: number;
  remaining: number;
}

export function CategorizeTransactionsDialog({
  uncategorizedCount,
}: CategorizeTransactionsDialogProps) {
  const queryClient = useQueryClient();
  const stopRequested = useRef(false);
  const [open, setOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [progress, setProgress] = useState<CategorizationProgress>({
    total: uncategorizedCount,
    processed: 0,
    remaining: uncategorizedCount,
  });

  const refreshData = () => {
    void queryClient.invalidateQueries({ queryKey: ["transactions"] });
    void queryClient.invalidateQueries({ queryKey: ["categorization-counts"] });
    void queryClient.invalidateQueries({ queryKey: ["budget"] });
    void queryClient.invalidateQueries({ queryKey: ["budget-uncategorized"] });
  };

  const openConfirmation = () => {
    setHasStarted(false);
    setIsStopping(false);
    setProgress({
      total: uncategorizedCount,
      processed: 0,
      remaining: uncategorizedCount,
    });
    setOpen(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isRunning) {
      stopRequested.current = true;
      setIsStopping(true);
      return;
    }
    setOpen(nextOpen);
  };

  const startCategorizing = async () => {
    const initialTotal = hasStarted ? progress.processed + progress.remaining : uncategorizedCount;
    let processed = hasStarted ? progress.processed : 0;
    let remaining = hasStarted ? progress.remaining : uncategorizedCount;

    setHasStarted(true);
    setIsRunning(true);
    setIsStopping(false);
    stopRequested.current = false;

    try {
      while (remaining > 0 && !stopRequested.current) {
        const result = await categorizeNextTransactions();
        processed += result.processed;
        remaining = result.remaining;
        setProgress({ total: initialTotal, processed, remaining });
        refreshData();

        if (result.done) break;
        if (result.processed === 0) {
          throw new Error(
            "The next batch could not be categorized. The remaining transactions were left unchanged."
          );
        }
      }

      if (remaining === 0) {
        toast.success(`Categorized ${processed.toLocaleString()} transactions for review`);
        setOpen(false);
      } else if (stopRequested.current) {
        toast.info(`Stopped with ${remaining.toLocaleString()} transactions remaining`);
        setOpen(false);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not categorize transactions"
      );
    } finally {
      setIsRunning(false);
      setIsStopping(false);
      refreshData();
    }
  };

  const percentage =
    progress.total === 0
      ? 100
      : Math.min(100, (progress.processed / progress.total) * 100);

  return (
    <>
      <Button
        type="button"
        onClick={openConfirmation}
        disabled={uncategorizedCount === 0 || isRunning}
      >
        <Sparkles className="h-4 w-4" />
        Categorize transactions
        {uncategorizedCount > 0 && (
          <span className="rounded-full bg-primary-foreground/15 px-1.5 text-xs">
            {uncategorizedCount.toLocaleString()}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Categorize transactions</DialogTitle>
            <DialogDescription>
              {isRunning || hasStarted
                ? "AI guesses are saved as Pending so you can review them before marking them Final."
                : `Categorize all ${uncategorizedCount.toLocaleString()} active Uncategorized transactions, regardless of the filters on this page?`}
            </DialogDescription>
          </DialogHeader>

          {hasStarted ? (
            <div className="space-y-3 py-2" aria-live="polite">
              <Progress value={percentage} />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{progress.processed.toLocaleString()} categorized</span>
                <span>{progress.remaining.toLocaleString()} remaining</span>
              </div>
            </div>
          ) : (
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              OpenAI receives only the transaction description, amount, account name,
              available categories, and representative Final examples. Notes and identity
              information are not sent.
            </div>
          )}

          <DialogFooter>
            {isRunning ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  stopRequested.current = true;
                  setIsStopping(true);
                }}
                disabled={isStopping}
              >
                {isStopping ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {isStopping ? "Stopping…" : "Stop after this batch"}
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={startCategorizing}>
                  <Sparkles className="h-4 w-4" />
                  {hasStarted ? "Resume" : "Categorize all"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
