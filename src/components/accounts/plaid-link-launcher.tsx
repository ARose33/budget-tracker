"use client";

import { useEffect, useRef } from "react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";

// Mount only after an explicit connect/repair request returns a Link token.
export function PlaidLinkLauncher({
  token,
  onSuccess,
  onExit,
}: {
  token: string;
  onSuccess: PlaidLinkOnSuccess;
  onExit: () => void;
}) {
  const opened = useRef(false);
  const { open, ready, error } = usePlaidLink({ token, onSuccess, onExit });
  useEffect(() => {
    if (error) onExit();
    else if (ready && !opened.current) {
      opened.current = true;
      open();
    }
  }, [error, onExit, open, ready]);
  return null;
}
