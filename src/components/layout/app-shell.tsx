"use client";

import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { MobileNav, Sidebar } from "@/components/layout/sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname.startsWith("/login");

  if (isAuthRoute) {
    return <main className="min-h-full">{children}</main>;
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <MobileNav />
        <main className="flex-1 overflow-y-auto px-3 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-4 md:px-8 md:py-8 md:pb-8">
          {children}
        </main>
      </div>
    </div>
  );
}
