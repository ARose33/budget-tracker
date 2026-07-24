"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Eye,
  EyeOff,
  Fingerprint,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  browserSupportsPasskeys,
  getPasskeyErrorMessage,
  getPasskeyPromptKey,
} from "@/lib/auth/passkeys";
import { supabase } from "@/lib/supabase/client";

type Mode = "sign-in" | "sign-up" | "reset-request";

const duplicateAccountMessage =
  "An account already exists for this email. Sign in or reset your password.";

const productionOrigin =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://budget-tracker-beta-bice.vercel.app";

const isDuplicateSignupError = (error: { code?: string; message?: string }) =>
  error.code === "user_already_exists" ||
  error.message?.includes("User already registered");

const isObfuscatedDuplicateSignup = (
  data: Awaited<ReturnType<typeof supabase.auth.signUp>>["data"]
) => !data.session && data.user?.identities?.length === 0;

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasskeySubmitting, setIsPasskeySubmitting] = useState(false);
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [passkeySetupEmail, setPasskeySetupEmail] = useState("");
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState("");
  const [pendingResetEmail, setPendingResetEmail] = useState("");

  const getAuthOrigin = () =>
    window.location.origin.includes("localhost")
      ? productionOrigin
      : window.location.origin;

  const getEmailRedirectTo = () =>
    `${getAuthOrigin()}/auth/callback?next=${encodeURIComponent(nextPath)}`;

  const getPasswordResetRedirectTo = () =>
    `${getAuthOrigin()}/reset-password`;

  const redirectAfterAuth = () => {
    router.replace(nextPath);
    router.refresh();
  };

  const markPasskeyPromptSeen = (authEmail: string) => {
    try {
      localStorage.setItem(getPasskeyPromptKey(authEmail), "1");
    } catch {
      // localStorage can be unavailable in private browsing or locked-down modes.
    }
  };

  const shouldOfferPasskeySetup = (authEmail: string) => {
    if (!browserSupportsPasskeys()) return false;

    try {
      return !localStorage.getItem(getPasskeyPromptKey(authEmail));
    } catch {
      return true;
    }
  };

  const finishAuthenticatedFlow = ({
    message,
    authEmail,
  }: {
    message: string;
    authEmail: string;
  }) => {
    toast.success(message);

    if (shouldOfferPasskeySetup(authEmail)) {
      markPasskeyPromptSeen(authEmail);
      setPasskeySetupEmail(authEmail);
      return;
    }

    redirectAfterAuth();
  };

  const handlePasskeySignIn = async () => {
    if (!browserSupportsPasskeys()) {
      toast.error("Passkeys are not available in this browser.");
      return;
    }

    setIsPasskeySubmitting(true);
    const { error } = await supabase.auth.signInWithPasskey();
    setIsPasskeySubmitting(false);

    if (error) {
      toast.error(getPasskeyErrorMessage(error));
      return;
    }

    toast.success("Signed in with passkey");
    redirectAfterAuth();
  };

  const handleRegisterPasskey = async () => {
    if (!passkeySetupEmail) return;

    if (!browserSupportsPasskeys()) {
      toast.error("Passkeys are not available in this browser.");
      redirectAfterAuth();
      return;
    }

    setIsRegisteringPasskey(true);
    const { error } = await supabase.auth.registerPasskey();
    setIsRegisteringPasskey(false);

    if (error) {
      toast.error(getPasskeyErrorMessage(error));
      return;
    }

    markPasskeyPromptSeen(passkeySetupEmail);
    toast.success("Face ID login is ready");
    redirectAfterAuth();
  };

  const handleSkipPasskeySetup = () => {
    if (passkeySetupEmail) {
      markPasskeyPromptSeen(passkeySetupEmail);
    }

    redirectAfterAuth();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    const credentials = {
      email: email.trim(),
      password,
    };

    if (mode === "reset-request") {
      const { error } = await supabase.auth.resetPasswordForEmail(
        credentials.email,
        {
          redirectTo: getPasswordResetRedirectTo(),
        }
      );

      setIsSubmitting(false);

      if (error) {
        toast.error(error.message);
        return;
      }

      setPendingResetEmail(credentials.email);
      toast.success("Password reset email sent.");
      return;
    }

    if (mode === "sign-up") {
      const { data, error } = await supabase.auth.signUp({
        ...credentials,
        options: {
          emailRedirectTo: getEmailRedirectTo(),
        },
      });

      setIsSubmitting(false);

      if (error) {
        if (isDuplicateSignupError(error)) {
          setPendingConfirmationEmail("");
          setMode("sign-in");
          setShowPassword(false);
          toast.error(duplicateAccountMessage);
          return;
        }

        toast.error(error.message);
        return;
      }

      if (isObfuscatedDuplicateSignup(data)) {
        setPendingConfirmationEmail("");
        setMode("sign-in");
        setShowPassword(false);
        toast.error(duplicateAccountMessage);
        return;
      }

      const needsEmailConfirmation = !data.session;
      if (needsEmailConfirmation) {
        setPendingConfirmationEmail(credentials.email);
        toast.success(
          data.user
            ? "Check your email to confirm your account."
            : "If this is a new account, check your email to confirm it. If you already have an account, sign in or reset your password."
        );
        return;
      }

      finishAuthenticatedFlow({
        message: "Account created",
        authEmail: credentials.email,
      });
      return;
    }

    const { error } = await supabase.auth.signInWithPassword(credentials);

    setIsSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    finishAuthenticatedFlow({
      message: "Signed in",
      authEmail: credentials.email,
    });
  };

  const handleResendConfirmation = async () => {
    const resendEmail = pendingConfirmationEmail || email.trim();
    if (!resendEmail) {
      toast.error("Enter your email first.");
      return;
    }

    setIsResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: resendEmail,
      options: {
        emailRedirectTo: getEmailRedirectTo(),
      },
    });
    setIsResending(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setPendingConfirmationEmail(resendEmail);
    toast.success("Confirmation email sent.");
  };

  if (passkeySetupEmail) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <CardTitle>Set up Face ID login</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            Add a passkey for {passkeySetupEmail}. Your password will still work
            as a backup.
          </p>
          <Button
            className="h-10 w-full"
            type="button"
            onClick={handleRegisterPasskey}
            disabled={isRegisteringPasskey}
          >
            {isRegisteringPasskey ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Fingerprint className="h-4 w-4" />
            )}
            Set up Face ID / Passkey
          </Button>
          <Button
            className="w-full"
            type="button"
            variant="ghost"
            onClick={handleSkipPasskeySetup}
            disabled={isRegisteringPasskey}
          >
            Not now
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Wallet className="h-6 w-6" />
        </div>
        <CardTitle>
          {mode === "sign-in"
            ? "Sign in to Budget Tracker"
            : mode === "sign-up"
              ? "Create your account"
              : "Reset your password"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {mode === "sign-in" ? (
          <>
            <Button
              className="h-10 w-full"
              type="button"
              onClick={handlePasskeySignIn}
              disabled={isPasskeySubmitting || isSubmitting}
            >
              {isPasskeySubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Fingerprint className="h-4 w-4" />
              )}
              Continue with Face ID / Passkey
            </Button>
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              <span>or use password</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        ) : null}
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="email">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          {mode !== "reset-request" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-medium" htmlFor="password">
                  Password
                </label>
                {mode === "sign-in" ? (
                  <button
                    className="text-sm text-primary hover:underline"
                    type="button"
                    onClick={() => {
                      setMode("reset-request");
                      setShowPassword(false);
                      setPendingConfirmationEmail("");
                      setPendingResetEmail("");
                    }}
                  >
                    Forgot password?
                  </button>
                ) : null}
              </div>
              <InputGroup>
                <InputGroupInput
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={
                    mode === "sign-in" ? "current-password" : "new-password"
                  }
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="button"
                    size="icon-xs"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    title={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>
          ) : null}
          <Button className="w-full" type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LockKeyhole className="h-4 w-4" />
            )}
            {mode === "sign-in"
              ? "Sign In"
              : mode === "sign-up"
                ? "Create Account"
                : "Send Reset Link"}
          </Button>
        </form>
        <Button
          className="mt-3 w-full"
          type="button"
          variant="ghost"
          onClick={() => {
            setMode(mode === "sign-in" ? "sign-up" : "sign-in");
            setShowPassword(false);
            setPendingConfirmationEmail("");
            setPendingResetEmail("");
          }}
        >
          {mode === "sign-in"
            ? "Need an account? Create one"
            : mode === "sign-up"
              ? "Already have an account? Sign in"
              : "Back to sign in"}
        </Button>
        {pendingResetEmail ? (
          <div className="mt-4 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            We sent a reset link to{" "}
            <span className="font-medium text-foreground">{pendingResetEmail}</span>.
            Check spam if you do not see it.
          </div>
        ) : null}
        {pendingConfirmationEmail ? (
          <div className="mt-4 rounded-md border bg-muted/40 p-3 text-sm">
            <p className="text-muted-foreground">
              We sent a confirmation link to{" "}
              <span className="font-medium text-foreground">
                {pendingConfirmationEmail}
              </span>
              . Check spam or resend it here.
            </p>
            <Button
              className="mt-3 w-full"
              type="button"
              variant="outline"
              onClick={handleResendConfirmation}
              disabled={isResending}
            >
              {isResending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Resend confirmation email
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
