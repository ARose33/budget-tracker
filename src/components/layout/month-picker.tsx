"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMonthSelector } from "@/hooks/use-month-selector";
import { monthKey } from "@/lib/finance/format";
export function MonthPicker() {
  const { year, month, label, goNext, goPrev, setMonth } = useMonthSelector();
  return <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
    <Button variant="ghost" size="icon" onClick={goPrev} disabled={year === 1900 && month === 1} aria-label="Previous month"><ChevronLeft className="size-4" /></Button>
    <label className="relative min-w-40 text-center"><span className="sr-only">Budget month</span><input aria-label="Budget month" type="month" defaultValue={monthKey(year, month)} key={monthKey(year, month)} min="1900-01" max="9998-12" className="min-h-10 w-40 rounded bg-transparent px-1 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary" title={label} onInput={event => {
      const [y, m] = event.currentTarget.value.split("-").map(Number);
      if (y >= 1900 && y <= 9998 && m >= 1 && m <= 12) setMonth(y, m);
    }} /></label>
    <Button variant="ghost" size="icon" onClick={goNext} disabled={year === 9998 && month === 12} aria-label="Next month"><ChevronRight className="size-4" /></Button>
    <Button variant="ghost" size="sm" onClick={() => { const today = new Date(); setMonth(today.getFullYear(), today.getMonth() + 1); }}>Today</Button>
  </div>;
}
