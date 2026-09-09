import type { QueryClient } from "@tanstack/react-query";
export function invalidateFinance(client: QueryClient) {
  // Financial edits can change carry in later months and every analysis period.
  // Invalidating all active views avoids a second list of partial dependencies.
  return client.invalidateQueries();
}
export function saveError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "The change could not be saved. Your draft is still here; retry when connected.";
}
