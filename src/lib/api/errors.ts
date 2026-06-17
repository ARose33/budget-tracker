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
      stringifyErrorPart(error.error),
      stringifyErrorPart(error.details),
      stringifyErrorPart(error.hint),
      stringifyErrorPart(error.code),
    ].filter((part): part is string => Boolean(part));

    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  return fallback;
}
