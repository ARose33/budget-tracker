"use client";

import { FormEvent, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Check,
  Fingerprint,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  browserSupportsPasskeys,
  getPasskeyErrorMessage,
} from "@/lib/auth/passkeys";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface PasskeyItem {
  id: string;
  friendly_name?: string;
  created_at: string;
  last_used_at?: string;
}

function getDisplayName(passkey: PasskeyItem) {
  return passkey.friendly_name || "Unnamed passkey";
}

function subscribeToPasskeySupport() {
  return () => {};
}

function getClientPasskeySupport() {
  return browserSupportsPasskeys();
}

function getServerPasskeySupport() {
  return false;
}

export function PasskeySettings() {
  const queryClient = useQueryClient();
  const isSupported = useSyncExternalStore(
    subscribeToPasskeySupport,
    getClientPasskeySupport,
    getServerPasskeySupport
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const passkeysQuery = useQuery({
    queryKey: ["passkeys"],
    queryFn: async (): Promise<PasskeyItem[]> => {
      const { data, error } = await supabase.auth.passkey.list();
      if (error) throw error;
      return data ?? [];
    },
    enabled: isSupported,
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      if (!browserSupportsPasskeys()) {
        throw new Error("Passkeys are not available in this browser.");
      }

      const { error } = await supabase.auth.registerPasskey();
      if (error) throw new Error(getPasskeyErrorMessage(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["passkeys"] });
      toast.success("Passkey added");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to add passkey"
      );
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({
      passkeyId,
      friendlyName,
    }: {
      passkeyId: string;
      friendlyName: string;
    }) => {
      const { error } = await supabase.auth.passkey.update({
        passkeyId,
        friendlyName,
      });
      if (error) throw new Error(getPasskeyErrorMessage(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["passkeys"] });
      setEditingId(null);
      setEditingName("");
      toast.success("Passkey renamed");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to rename passkey"
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (passkeyId: string) => {
      const { error } = await supabase.auth.passkey.delete({ passkeyId });
      if (error) throw new Error(getPasskeyErrorMessage(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["passkeys"] });
      toast.success("Passkey removed");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove passkey"
      );
    },
  });

  const passkeys = passkeysQuery.data ?? [];

  const startEditing = (passkey: PasskeyItem) => {
    setEditingId(passkey.id);
    setEditingName(getDisplayName(passkey));
  };

  const submitRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingId) return;

    const nextName = editingName.trim();
    if (!nextName) {
      toast.error("Passkey name is required.");
      return;
    }

    renameMutation.mutate({ passkeyId: editingId, friendlyName: nextName });
  };

  return (
    <Card>
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-primary" />
          Face ID & Passkeys
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {!isSupported ? (
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            Passkeys are not available in this browser. Password sign-in will
            continue to work.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Use a passkey to sign in with Face ID, Touch ID, Windows Hello,
                or your password manager.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => registerMutation.mutate()}
                disabled={registerMutation.isPending}
              >
                {registerMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add passkey
              </Button>
            </div>

            {passkeysQuery.isLoading ? (
              <div className="flex h-16 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : passkeysQuery.error ? (
              <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                {getPasskeyErrorMessage(passkeysQuery.error)}
              </p>
            ) : passkeys.length > 0 ? (
              <div className="divide-y rounded-lg border">
                {passkeys.map((passkey) => (
                  <div
                    key={passkey.id}
                    className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    {editingId === passkey.id ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-2"
                        onSubmit={submitRename}
                      >
                        <Input
                          value={editingName}
                          onChange={(event) =>
                            setEditingName(event.target.value)
                          }
                          maxLength={120}
                          autoFocus
                        />
                        <Button
                          type="submit"
                          size="icon-sm"
                          aria-label="Save passkey name"
                          disabled={renameMutation.isPending}
                        >
                          {renameMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Cancel rename"
                          onClick={() => {
                            setEditingId(null);
                            setEditingName("");
                          }}
                          disabled={renameMutation.isPending}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </form>
                    ) : (
                      <>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {getDisplayName(passkey)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Added{" "}
                            {format(new Date(passkey.created_at), "MMM d, yyyy")}
                            {passkey.last_used_at
                              ? ` - Last used ${format(new Date(passkey.last_used_at), "MMM d, yyyy")}`
                              : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Rename ${getDisplayName(passkey)}`}
                            title={`Rename ${getDisplayName(passkey)}`}
                            onClick={() => startEditing(passkey)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Remove ${getDisplayName(passkey)}`}
                            title={`Remove ${getDisplayName(passkey)}`}
                            onClick={() => deleteMutation.mutate(passkey.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                No passkeys are set up for this account.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
