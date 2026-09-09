const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const money = (amount: number) => dollars.format(Object.is(amount, -0) ? 0 : amount);
export function parseAmount(input: string): number {
  if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(input.trim())) throw new Error("Enter a nonnegative amount with at most two decimal places.");
  const [whole, fraction = ""] = input.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return cents / 100;
}
export function sumMoney(values: number[]): number {
  return values.reduce((total, value) => total + Math.round(value * 100), 0) / 100;
}
export function monthKey(year: number, month: number) {
  return String(year) + "-" + String(month).padStart(2, "0");
}
export function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}
