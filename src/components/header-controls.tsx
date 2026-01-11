"use client";

import { SyncProvider } from "@/components/sync-context";
import { AutoSyncToggle } from "@/components/auto-sync-toggle";
import { SyncButton } from "@/components/sync-button";
import { SignOutButton } from "@/components/sign-out-button";

interface HeaderControlsProps {
  totalEmails: number;
  lastSyncedAt: Date | null;
}

export function HeaderControls({
  totalEmails,
  lastSyncedAt,
}: HeaderControlsProps) {
  return (
    <SyncProvider>
      <div className="flex items-center gap-4">
        <div className="text-sm text-gray-500 text-right">
          <div>{totalEmails} emails</div>
          {lastSyncedAt && (
            <div className="text-xs">
              Last sync: {new Date(lastSyncedAt).toLocaleString()}
            </div>
          )}
        </div>
        <AutoSyncToggle />
        <SyncButton />
        <SignOutButton />
      </div>
    </SyncProvider>
  );
}
