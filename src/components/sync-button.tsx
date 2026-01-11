"use client";

import { Button } from "@/components/ui/button";
import { useSyncContext } from "@/components/sync-context";

export function SyncButton() {
  const { isSyncing, progressText, isError, triggerSync } = useSyncContext();

  return (
    <div className="flex items-center gap-2">
      {progressText && (
        <span
          className={`text-sm ${isError ? "text-red-500" : "text-gray-500"}`}
        >
          {progressText}
        </span>
      )}
      <Button onClick={triggerSync} disabled={isSyncing}>
        {isSyncing ? "Syncing..." : "Sync Emails"}
      </Button>
    </div>
  );
}
