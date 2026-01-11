"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useSyncContext } from "@/components/sync-context";

export function AutoSyncToggle() {
  const { isAutoSyncEnabled, setAutoSyncEnabled } = useSyncContext();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5">
          <Switch
            id="auto-sync"
            checked={isAutoSyncEnabled}
            onCheckedChange={setAutoSyncEnabled}
          />
          <Label htmlFor="auto-sync" className="text-sm cursor-pointer">
            Auto-sync
          </Label>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        Automatically sync new unread emails every minute
      </TooltipContent>
    </Tooltip>
  );
}
