"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { disconnectMailboxAction } from "./actions";

export function DisconnectButton() {
  const [isPending, startTransition] = useTransition();

  function handleDisconnect() {
    if (!window.confirm("Disconnect your mailbox? You'll need to reconnect before sending or scheduling email again.")) return;
    startTransition(() => disconnectMailboxAction());
  }

  return (
    <Button type="button" variant="destructive" disabled={isPending} onClick={handleDisconnect}>
      {isPending ? "Disconnecting..." : "Disconnect"}
    </Button>
  );
}
