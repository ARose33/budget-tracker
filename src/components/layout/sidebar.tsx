"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Receipt,
  TrendingUp,
  DollarSign,
  CalendarRange,
  Landmark,
  Menu,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";

const navSections: {
  label?: string;
  items: { href: string; label: string; icon: typeof LayoutDashboard }[];
}[] = [
  {
    items: [
      { href: "/budget", label: "Budget", icon: LayoutDashboard },
      { href: "/transactions", label: "Transactions", icon: Receipt },
      { href: "/accounts", label: "Accounts", icon: Landmark },
    ],
  },
  {
    label: "Analysis",
    items: [
      { href: "/analysis/spending", label: "Spending Trends", icon: TrendingUp },
      { href: "/analysis/cashflow", label: "Cash Flow", icon: DollarSign },
      { href: "/analysis/yoy", label: "Year over Year", icon: CalendarRange },
    ],
  },
];

function NavLinks({ onClick }: { onClick?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-6 px-4 py-6 h-full">
      <Link href="/budget" onClick={onClick} className="flex items-center gap-2.5 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 shadow-lg shadow-emerald-500/30">
          <Wallet className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight text-sidebar-foreground leading-tight">
            Budget
          </h1>
          <p className="text-[11px] text-sidebar-foreground/60 leading-tight">
            Personal Finance
          </p>
        </div>
      </Link>

      <div className="flex flex-col gap-6 flex-1">
        {navSections.map((section, idx) => (
          <div key={idx} className="flex flex-col gap-1">
            {section.label && (
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClick}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-sidebar-primary" />
                  )}
                  <item.icon
                    className={cn(
                      "h-4 w-4 transition-colors",
                      isActive
                        ? "text-sidebar-primary"
                        : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80"
                    )}
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="px-3 pt-4 border-t border-sidebar-border">
        <p className="text-[11px] text-sidebar-foreground/40">
          Last updated today
        </p>
      </div>
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden md:flex md:w-64 md:flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <NavLinks />
    </aside>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden flex items-center border-b bg-background/80 backdrop-blur px-4 py-3 sticky top-0 z-30">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger className="inline-flex items-center justify-center rounded-md h-9 w-9 hover:bg-accent hover:text-accent-foreground transition-colors">
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0 bg-sidebar text-sidebar-foreground border-sidebar-border">
          <NavLinks onClick={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex items-center gap-2 ml-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 shadow-md shadow-emerald-500/30">
          <Wallet className="h-4 w-4 text-white" />
        </div>
        <span className="font-semibold tracking-tight">Budget Tracker</span>
      </div>
    </div>
  );
}
