"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPreparingSession, setIsPreparingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function prepareRecoverySession() {
      const url = new URL(window.location.href);
      const queryParams = url.searchParams;
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
      const authError =
        queryParams.get("error_description") ||
        hashParams.get("error_description") ||
        queryParams.get("error") ||
        hashParams.get("error");

      if (authError) {
        if (isMounted) {
          setRecoveryError(authError.replaceAll("+", " "));
          setIsPreparingSession(false);
        }
        return;
      }

      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const code = queryParams.get("code");

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          if (isMounted) {
            setRecoveryError(error.message);
            setIsPreparingSession(false);
          }
          return;
        }
      } else {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          if (isMounted) {
            setRecoveryError(sessionError.message);
            setIsPreparingSession(false);
          }
          return;
        }

        if (!session && code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            if (isMounted) {
              setRecoveryError(error.message);
              setIsPreparingSession(false);
            }
            return;
          }
        }
      }

      window.history.replaceState(null, "", "/reset-password");
      if (isMounted) setIsPreparingSession(false);
    }

    prepareRecoverySession().catch((error: unknown) => {
      if (isMounted) {
        setRecoveryError(
          error instanceof Error ? error.message : "Unable to open reset link."
        );
        setIsPreparingSession(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (recoveryError || isPreparingSession) {
      toast.error("Open the latest password reset link from your email first.");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Password updated. Sign in with your new password.");
    await supabase.auth.signOut();
    router.replace("/login?next=%2Fbudget");
    router.refresh();
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Wallet className="h-6 w-6" />
        </div>
        <CardTitle>Set a new password</CardTitle>
      </CardHeader>
      <CardContent>
        {isPreparingSession ? (
          <div className="flex items-center justify-center gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Opening reset link...
          </div>
        ) : null}
        {recoveryError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            This reset link could not be opened. Request a new password reset
            email and use the latest link.
          </div>
        ) : null}
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="new-password">
              New password
            </label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="confirm-password">
              Confirm password
            </label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={6}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </div>
          <Button
            className="w-full"
            type="submit"
            disabled={isSubmitting || isPreparingSession || Boolean(recoveryError)}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LockKeyhole className="h-4 w-4" />
            )}
            Update Password
          </Button>
        </form>
        {recoveryError ? (
          <Button
            className="mt-3 w-full"
            type="button"
            variant="ghost"
            onClick={() => router.replace("/login")}
          >
            Request a new reset link
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
