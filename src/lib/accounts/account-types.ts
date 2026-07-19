export const SUPPORTED_ACCOUNT_TYPES = [
  "Checking",
  "Savings",
  "Credit Card",
] as const;

export type SupportedAccountType = (typeof SUPPORTED_ACCOUNT_TYPES)[number];

export function isSupportedAccountType(
  type: string | null | undefined
): type is SupportedAccountType {
  return SUPPORTED_ACCOUNT_TYPES.includes(type as SupportedAccountType);
}
