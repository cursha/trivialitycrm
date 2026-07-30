"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { resumeCallingSession } from "../actions";

export function SessionControls({
  sessionId,
  status,
  nextEntryId,
}: {
  sessionId: string;
  status: "ACTIVE" | "PAUSED" | "COMPLETED" | "ENDED";
  nextEntryId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (status === "ACTIVE" && nextEntryId) {
    return <Button onClick={() => router.push(`/calling-sessions/${sessionId}/${nextEntryId}`)}>Continue session</Button>;
  }

  if (status === "PAUSED") {
    return (
      <Button
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await resumeCallingSession(sessionId);
            router.refresh();
          })
        }
      >
        Resume session
      </Button>
    );
  }

  return null;
}
