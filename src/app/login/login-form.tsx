"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, LockKeyhole, Wallet } from "lucide-react";
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
import { supabase } from "@/lib/supabase/client";

type Mode = "sign-in" | "sign-up" | "reset-request";

const productionOrigin =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://budget-tracker-beta-bice.vercel.app";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
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
        toast.error(error.message);
        return;
      }

      const needsEmailConfirmation = !data.session;
      if (needsEmailConfirmation) {
        setPendingConfirmationEmail(credentials.email);
        toast.success("Check your email to confirm your account.");
        return;
      }

      toast.success("Account created");
      router.replace(nextPath);
      router.refresh();
      return;
    }

    const { error } = await supabase.auth.signInWithPassword(credentials);

    setIsSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Signed in");
    router.replace(nextPath);
    router.refresh();
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
