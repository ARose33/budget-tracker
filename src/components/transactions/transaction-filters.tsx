"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CategorySelect } from "./category-select";
import { Search, X, Filter } from "lucide-react";
import type { TransactionFilters } from "@/lib/queries/transactions";

interface TransactionFiltersBarProps {
  filters: TransactionFilters;
  onChange: (filters: TransactionFilters) => void;
  uncategorizedCount?: number;
}

export function TransactionFiltersBar({
  filters,
  onChange,
  uncategorizedCount,
}: TransactionFiltersBarProps) {
  const hasFilters =
    filters.search ||
    filters.categoryId ||
    filters.status ||
    filters.uncategorizedOnly ||
    filters.dateFrom ||
    filters.dateTo;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search transactions..."
            value={filters.search || ""}
            onChange={(e) => onChange({ ...filters, search: e.target.value || undefined })}
            className="pl-9"
          />
        </div>
        <CategorySelect
          value={filters.categoryId ?? null}
          onValueChange={(v) =>
            onChange({ ...filters, categoryId: v === "__uncategorized__" ? undefined : v })
          }
          placeholder="All categories"
          className="w-[200px]"
        />
        <Input
          type="date"
          value={filters.dateFrom || ""}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value || undefined })}
          className="w-[150px]"
          placeholder="From"
        />
        <Input
          type="date"
          value={filters.dateTo || ""}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value || undefined })}
          className="w-[150px]"
          placeholder="To"
        />
        <Button
          variant={filters.uncategorizedOnly ? "default" : "outline"}
          size="sm"
          onClick={() =>
            onChange({ ...filters, uncategorizedOnly: !filters.uncategorizedOnly })
          }
        >
          <Filter className="h-3.5 w-3.5 mr-1" />
          Uncategorized
          {uncategorizedCount != null && (
            <Badge variant="secondary" className="ml-1.5">
              {uncategorizedCount.toLocaleString()}
            </Badge>
          )}
        </Button>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({})}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
