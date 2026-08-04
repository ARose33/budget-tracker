"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Search, X, Filter, ChevronsUpDown } from "lucide-react";
import { getCategories, type Category } from "@/lib/queries/categories";
import { getAccounts, type Account } from "@/lib/queries/accounts";
import type { TransactionFilters } from "@/lib/queries/transactions";

interface TransactionFiltersBarProps {
  filters: TransactionFilters;
  onChange: (filters: TransactionFilters) => void;
  uncategorizedCount?: number;
}

function getCategoryType(value: string | null | undefined) {
  if (value?.toLowerCase() === "income") return "Income" as const;
  if (value?.toLowerCase() === "expense") return "Expense" as const;
  return undefined;
}

export function TransactionFiltersBar({
  filters,
  onChange,
  uncategorizedCount,
}: TransactionFiltersBarProps) {
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: getCategories,
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: getAccounts,
  });

  const typeCategories = useMemo(
    () =>
      filters.categoryType
        ? categories.filter(
            (category) => getCategoryType(category.category_type) === filters.categoryType
          )
        : categories,
    [categories, filters.categoryType]
  );

  const groups = useMemo(
    () =>
      [...new Set(typeCategories.map((category) => category.group_name))].sort(
        (a, b) => a.localeCompare(b)
      ),
    [typeCategories]
  );

  const lineItemCategories = useMemo(() => {
    const filtered = filters.categoryGroup
      ? typeCategories.filter(
          (category) => category.group_name === filters.categoryGroup
        )
      : typeCategories;

    return [...filtered].sort((a, b) => {
      const groupCompare = a.group_name.localeCompare(b.group_name);
      if (groupCompare !== 0) return groupCompare;
      return a.line_item_name.localeCompare(b.line_item_name);
    });
  }, [typeCategories, filters.categoryGroup]);

  const selectedLineItem = categories.find(
    (category) => category.id === filters.categoryId
  );

  const hasFilters =
    filters.search ||
    filters.categoryType ||
    filters.categoryGroup ||
    filters.categoryId ||
    filters.accountId ||
    filters.status ||
    filters.uncategorizedOnly ||
    filters.dateFrom ||
    filters.dateTo;

  const handleTypeChange = (
    categoryType: TransactionFilters["categoryType"]
  ) => {
    const selectedCategory = categories.find(
      (category) => category.id === filters.categoryId
    );
    const categoryMatches =
      !categoryType ||
      getCategoryType(selectedCategory?.category_type) === categoryType;
    const groupExists =
      !filters.categoryGroup ||
      categories.some(
        (category) =>
          category.group_name === filters.categoryGroup &&
          (!categoryType || getCategoryType(category.category_type) === categoryType)
      );

    onChange({
      ...filters,
      categoryType,
      categoryGroup: groupExists ? filters.categoryGroup : undefined,
      categoryId: categoryMatches ? filters.categoryId : undefined,
      uncategorizedOnly: false,
    });
  };

  const handleGroupChange = (groupName: string | undefined) => {
    const selectedCategory = categories.find(
      (category) => category.id === filters.categoryId
    );
    const shouldKeepLineItem =
      groupName &&
      selectedCategory?.group_name === groupName &&
      (!filters.categoryType ||
        getCategoryType(selectedCategory.category_type) === filters.categoryType);

    onChange({
      ...filters,
      categoryGroup: groupName,
      categoryId: shouldKeepLineItem ? filters.categoryId : undefined,
      uncategorizedOnly: false,
    });
  };

  const handleLineItemChange = (categoryId: string | undefined) => {
    const category = categories.find((cat) => cat.id === categoryId);

    onChange({
      ...filters,
      categoryType:
        getCategoryType(category?.category_type) ?? filters.categoryType,
      categoryGroup: category?.group_name ?? filters.categoryGroup,
      categoryId,
      uncategorizedOnly: false,
    });
  };

  const toggleUncategorizedOnly = () => {
    const nextUncategorizedOnly = !filters.uncategorizedOnly;

    onChange({
      ...filters,
      uncategorizedOnly: nextUncategorizedOnly,
      categoryType: nextUncategorizedOnly ? undefined : filters.categoryType,
      categoryGroup: nextUncategorizedOnly ? undefined : filters.categoryGroup,
      categoryId: nextUncategorizedOnly ? undefined : filters.categoryId,
    });
  };

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
        <CategoryTypeFilter
          value={filters.categoryType}
          onValueChange={handleTypeChange}
        />
        <CategoryGroupFilter
          groups={groups}
          value={filters.categoryGroup}
          onValueChange={handleGroupChange}
        />
        <LineItemFilter
          categories={lineItemCategories}
          value={filters.categoryId}
          selectedCategory={selectedLineItem}
          onValueChange={handleLineItemChange}
        />
        <AccountFilter
          accounts={accounts}
          value={filters.accountId}
          onValueChange={(accountId) =>
            onChange({ ...filters, accountId })
          }
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
          onClick={toggleUncategorizedOnly}
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

function CategoryTypeFilter({
  value,
  onValueChange,
}: {
  value?: "Income" | "Expense";
  onValueChange: (value: "Income" | "Expense" | undefined) => void;
}) {
  const [open, setOpen] = useState(false);

  const selectValue = (nextValue: "Income" | "Expense" | undefined) => {
    onValueChange(nextValue);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="w-[135px] justify-between font-normal"
          />
        }
      >
        <span>{value ?? "All types"}</span>
        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) p-0">
        <Command loop>
          <CommandList>
            <CommandItem
              value="All types"
              onSelect={() => selectValue(undefined)}
              data-checked={!value}
            >
              All types
            </CommandItem>
            <CommandItem
              value="Income"
              onSelect={() => selectValue("Income")}
              data-checked={value === "Income"}
            >
              Income
            </CommandItem>
            <CommandItem
              value="Expense"
              onSelect={() => selectValue("Expense")}
              data-checked={value === "Expense"}
            >
              Expense
            </CommandItem>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AccountFilter({
  accounts,
  value,
  onValueChange,
}: {
  accounts: Account[];
  value?: string;
  onValueChange: (value: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedAccount = accounts.find((account) => account.id === value);

  const selectValue = (nextValue: string | undefined) => {
    onValueChange(nextValue);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="w-[190px] justify-between font-normal"
          />
        }
      >
        <span className="min-w-0 truncate">
          {selectedAccount?.name ?? "All accounts"}
        </span>
        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
        <Command loop>
          <CommandInput placeholder="Search accounts..." autoFocus />
          <CommandList>
            <CommandEmpty>No accounts found.</CommandEmpty>
            <CommandItem
              value="All accounts"
              keywords={["all", "accounts"]}
              onSelect={() => selectValue(undefined)}
              data-checked={!value}
            >
              All accounts
            </CommandItem>
            {accounts.map((account) => (
              <CommandItem
                key={account.id}
                value={`${account.name} ${account.institution}`}
                keywords={[account.name, account.institution]}
                onSelect={() => selectValue(account.id)}
                data-checked={value === account.id}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{account.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {account.institution}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CategoryGroupFilter({
  groups,
  value,
  onValueChange,
}: {
  groups: string[];
  value?: string;
  onValueChange: (value: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);

  const selectValue = (nextValue: string | undefined) => {
    onValueChange(nextValue);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="w-[160px] justify-between font-normal"
          />
        }
      >
        <span className="min-w-0 truncate">{value ?? "All groups"}</span>
        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-56 p-0">
        <Command loop>
          <CommandInput placeholder="Search groups..." autoFocus />
          <CommandList>
            <CommandEmpty>No groups found.</CommandEmpty>
            <CommandItem
              value="All groups"
              keywords={["all", "groups"]}
              onSelect={() => selectValue(undefined)}
              data-checked={!value}
            >
              All groups
            </CommandItem>
            {groups.map((group) => (
              <CommandItem
                key={group}
                value={group}
                onSelect={() => selectValue(group)}
                data-checked={value === group}
              >
                <span className="min-w-0 truncate">{group}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function LineItemFilter({
  categories,
  value,
  selectedCategory,
  onValueChange,
}: {
  categories: Category[];
  value?: string;
  selectedCategory?: Category;
  onValueChange: (value: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);

  const selectValue = (nextValue: string | undefined) => {
    onValueChange(nextValue);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="w-[190px] justify-between font-normal"
          />
        }
      >
        <span className="min-w-0 truncate">
          {selectedCategory?.line_item_name ?? "All line items"}
        </span>
        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
        <Command loop>
          <CommandInput placeholder="Search line items..." autoFocus />
          <CommandList>
            <CommandEmpty>No line items found.</CommandEmpty>
            <CommandItem
              value="All line items"
              keywords={["all", "line", "items", "categories"]}
              onSelect={() => selectValue(undefined)}
              data-checked={!value}
            >
              All line items
            </CommandItem>
            {categories.map((category) => (
              <CommandItem
                key={category.id}
                value={`${category.line_item_name} ${category.group_name}`}
                keywords={[category.line_item_name, category.group_name]}
                onSelect={() => selectValue(category.id)}
                data-checked={value === category.id}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{category.line_item_name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {category.group_name}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
