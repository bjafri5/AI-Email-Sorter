"use client";

import { useState, useEffect } from "react";
import { SyncProvider } from "@/components/sync-context";
import { AutoSyncToggle } from "@/components/auto-sync-toggle";
import { SyncButton } from "@/components/sync-button";
import { SignOutButton } from "@/components/sign-out-button";

interface HeaderControlsProps {
  totalEmails: number;
  lastSyncedAt: Date | null;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function HeaderControls({
  totalEmails,
  lastSyncedAt,
}: HeaderControlsProps) {
  // Force re-render every minute to update relative time
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  // Compute relative time directly (re-computed on each render)
  const relativeTime = lastSyncedAt
    ? formatRelativeTime(new Date(lastSyncedAt))
    : null;

  return (
    <SyncProvider>
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500">
          <span>{totalEmails} emails</span>
          {relativeTime && (
            <>
              <span className="text-gray-300">|</span>
              <span title={lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : ""}>
                Synced {relativeTime}
              </span>
            </>
          )}
        </div>
        <AutoSyncToggle />
        <SyncButton />
        <SignOutButton />
      </div>
    </SyncProvider>
  );
}
