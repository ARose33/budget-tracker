interface ErrorLikeObject {
  message?: unknown;
  error?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
}

function isErrorLikeObject(value: unknown): value is ErrorLikeObject {
  return Boolean(value && typeof value === "object");
}

function stringifyErrorPart(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function getErrorMessage(error: unknown, fallback = "Unknown error") {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }

  if (isErrorLikeObject(error)) {
    const parts = [
      stringifyErrorPart(error.message),
      // Database details and hints can include entire financial records.
      // Only the public message belongs in an API response.
    ].filter((part): part is string => Boolean(part));

    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  return fallback;
}
