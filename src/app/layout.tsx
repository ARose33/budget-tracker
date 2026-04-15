import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { Sidebar, MobileNav } from "@/components/layout/sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Budget Tracker",
  description: "Personal budget tracking and financial analysis",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full bg-background">
        <Providers>
          <div className="flex h-full">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <MobileNav />
              <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
                {children}
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
