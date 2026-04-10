"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMonthSelector } from "@/hooks/use-month-selector";

export function MonthPicker() {
  const { label, goNext, goPrev } = useMonthSelector();

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" onClick={goPrev}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-lg font-semibold min-w-[160px] text-center">
        {label}
      </span>
      <Button variant="outline" size="icon" onClick={goNext}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
