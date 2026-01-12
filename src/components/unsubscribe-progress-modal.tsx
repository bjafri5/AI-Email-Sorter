"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { friendlyUnsubscribeErrorMessage } from "@/lib/error-messages";

export interface ProgressLogItem {
  emailId: string;
  fromEmail: string;
  status: "pending" | "processing" | "success" | "failed";
  message?: string;
}

interface UnsubscribeProgressModalProps {
  open: boolean;
  progressLog: ProgressLogItem[];
  progress: {
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
  } | null;
}

export function UnsubscribeProgressModal({
  open,
  progressLog,
  progress,
}: UnsubscribeProgressModalProps) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Unsubscribing...</DialogTitle>
          <DialogDescription>
            {progress
              ? `Processed ${progress.processed} of ${progress.total} emails`
              : "Starting..."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-80 overflow-y-auto">
          {progressLog.map((item, index) => (
            <div
              key={index}
              className={`p-3 rounded text-sm flex items-center gap-3 ${
                item.status === "processing"
                  ? "bg-blue-50 border border-blue-200"
                  : item.status === "success"
                  ? "bg-green-50"
                  : item.status === "failed"
                  ? "bg-red-50"
                  : "bg-gray-50"
              }`}
            >
              <div className="flex-shrink-0">
                {item.status === "pending" && (
                  <span className="text-gray-400">○</span>
                )}
                {item.status === "processing" && (
                  <span className="inline-block animate-spin text-blue-600">
                    ◐
                  </span>
                )}
                {item.status === "success" && (
                  <span className="text-green-600">✓</span>
                )}
                {item.status === "failed" && (
                  <span className="text-red-600">✗</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{item.fromEmail}</div>
                {item.status === "processing" && (
                  <div className="text-xs text-blue-600">
                    Navigating unsubscribe page...
                  </div>
                )}
                {item.status === "success" && (
                  <div className="text-xs text-green-600">Unsubscribed</div>
                )}
                {item.status === "failed" && item.message && (
                  <div className="text-xs text-red-600">
                    {friendlyUnsubscribeErrorMessage(item.message)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {progress && (
          <div className="flex gap-4 text-sm pt-2 border-t">
            <span className="text-green-600">
              ✓ {progress.succeeded} succeeded
            </span>
            <span className="text-red-600">✗ {progress.failed} failed</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
