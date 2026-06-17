"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { getCategories } from "@/lib/queries/categories";
import { cn } from "@/lib/utils";
import { ChevronsUpDown } from "lucide-react";

interface CategorySelectProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
  includeUncategorized?: boolean;
  displayMode?: "full" | "lineItem";
}

export function CategorySelect({
  value,
  onValueChange,
  placeholder = "Select category",
  className,
  includeUncategorized = true,
  displayMode = "full",
}: CategorySelectProps) {
  const [open, setOpen] = useState(false);
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: getCategories,
  });

  const sortedCategories = useMemo(
    () =>
      [...categories].sort((a, b) => {
        const groupCompare = a.group_name.localeCompare(b.group_name);
        if (groupCompare !== 0) return groupCompare;
        return a.line_item_name.localeCompare(b.line_item_name);
      }),
    [categories]
  );

  const selectedCategory = categories.find((cat) => cat.id === value);
  const selectedLabel = selectedCategory
    ? displayMode === "lineItem"
      ? selectedCategory.line_item_name
      : `${selectedCategory.group_name}: ${selectedCategory.line_item_name}`
    : null;

  return (
    <Popover open={open} onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("justify-between font-normal", className)}
          />
        }
      >
        <span className="min-w-0 truncate">
          {selectedLabel ?? placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
        <Command loop>
          <CommandInput placeholder="Search categories..." autoFocus />
          <CommandList>
            <CommandEmpty>No categories found.</CommandEmpty>
            {includeUncategorized && (
              <CommandItem
                value="Uncategorized"
                keywords={["none", "clear", "uncategorized"]}
                onSelect={() => {
                  onValueChange(null);
                  setOpen(false);
                }}
                data-checked={value == null}
              >
                Uncategorized
              </CommandItem>
            )}
            {sortedCategories.map((cat) => {
              const label = `${cat.group_name}: ${cat.line_item_name}`;
              return (
                <CommandItem
                  key={cat.id}
                  value={label}
                  keywords={[cat.group_name, cat.line_item_name]}
                  onSelect={() => {
                    onValueChange(cat.id);
                    setOpen(false);
                  }}
                  data-checked={value === cat.id}
                >
                  {displayMode === "lineItem" ? (
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{cat.line_item_name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {cat.group_name}
                      </span>
                    </span>
                  ) : (
                    <span className="min-w-0 truncate">{label}</span>
                  )}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
