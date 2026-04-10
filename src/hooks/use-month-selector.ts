"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";
import { format, addMonths, subMonths } from "date-fns";

export function useMonthSelector() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const now = new Date();
  const year = Number(searchParams.get("year")) || now.getFullYear();
  const month = Number(searchParams.get("month")) || now.getMonth() + 1;

  const currentDate = useMemo(
    () => new Date(year, month - 1, 1),
    [year, month]
  );

  const setMonth = useCallback(
    (y: number, m: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("year", String(y));
      params.set("month", String(m));
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  const goNext = useCallback(() => {
    const next = addMonths(currentDate, 1);
    setMonth(next.getFullYear(), next.getMonth() + 1);
  }, [currentDate, setMonth]);

  const goPrev = useCallback(() => {
    const prev = subMonths(currentDate, 1);
    setMonth(prev.getFullYear(), prev.getMonth() + 1);
  }, [currentDate, setMonth]);

  const label = format(currentDate, "MMMM yyyy");

  return { year, month, currentDate, label, goNext, goPrev, setMonth };
}
