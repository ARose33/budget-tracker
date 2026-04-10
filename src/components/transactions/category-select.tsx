"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getCategories, groupCategories } from "@/lib/queries/categories";

interface CategorySelectProps {
  value: string | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function CategorySelect({
  value,
  onValueChange,
  placeholder = "Select category",
  className,
}: CategorySelectProps) {
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: getCategories,
  });

  const grouped = groupCategories(categories);

  return (
    <Select value={value ?? ""} onValueChange={(v) => v && onValueChange(v)}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__uncategorized__">Uncategorized</SelectItem>
        {Array.from(grouped.entries()).map(([groupName, items]) => (
          <SelectGroup key={groupName}>
            <SelectLabel>{groupName}</SelectLabel>
            {items.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.line_item_name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
