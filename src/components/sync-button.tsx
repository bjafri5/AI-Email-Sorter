"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function SyncButton() {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    setProgress("Starting...");
    setIsError(false);

    try {
      const response = await fetch("/api/gmail/sync", { method: "POST" });

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));

            if (data.type === "fetching") {
              setProgress("Fetching emails...");
            } else if (data.type === "start") {
              setProgress(`0/${data.total} processed`);
            } else if (data.type === "progress") {
              setProgress(`${data.current}/${data.total} processed`);
            } else if (data.type === "complete") {
              const parts = [];
              if (data.totalProcessed > 0) parts.push(`${data.totalProcessed} new`);
              if (data.totalSkipped > 0) parts.push(`${data.totalSkipped} skipped`);
              if (data.totalErrors > 0) parts.push(`${data.totalErrors} errors`);
              setProgress(parts.length > 0 ? `Done! ${parts.join(", ")}` : "Done! No new emails");
              setIsError(false);
            } else if (data.type === "error") {
              setProgress(data.message);
              setIsError(true);
            }
          }
        }
      }

      router.refresh();
    } catch (error) {
      setProgress(`Error: ${error}`);
      setIsError(true);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {progress && (
        <span
          className={`text-sm ${isError ? "text-red-500" : "text-gray-500"}`}
        >
          {progress}
        </span>
      )}
      <Button onClick={handleSync} disabled={isSyncing}>
        {isSyncing ? "Syncing..." : "Sync Emails"}
      </Button>
    </div>
  );
}
