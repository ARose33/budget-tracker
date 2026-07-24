"use client";

type AuthLikeError = {
  code?: string;
  message?: string;
  name?: string;
};

export function browserSupportsPasskeys() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "PublicKeyCredential" in window &&
    Boolean(navigator.credentials)
  );
}

export function getPasskeyPromptKey(email: string) {
  return `budget-tracker-passkey-prompt:${email.trim().toLowerCase()}`;
}

export function getPasskeyErrorMessage(error: AuthLikeError) {
  if (error.code === "passkey_disabled") {
    return "Passkeys are not enabled for this Supabase project yet. Use your password for now.";
  }

  if (error.code === "webauthn_credential_exists") {
    return "This device already has a passkey for your account.";
  }

  if (
    error.name === "NotAllowedError" ||
    error.message?.toLowerCase().includes("cancel")
  ) {
    return "Passkey sign-in was canceled.";
  }

  return error.message || "Passkey authentication failed.";
}
