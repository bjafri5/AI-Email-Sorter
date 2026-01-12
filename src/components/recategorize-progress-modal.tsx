"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export interface RecategorizeProgressLogItem {
  emailId: string;
  fromEmail: string;
  fromName: string | null;
  status: "pending" | "processing" | "success" | "failed";
  categoryName?: string | null;
}

interface RecategorizeProgressModalProps {
  open: boolean;
  progressLog: RecategorizeProgressLogItem[];
  progress: {
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
  } | null;
}

export function RecategorizeProgressModal({
  open,
  progressLog,
  progress,
}: RecategorizeProgressModalProps) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Recategorizing...</DialogTitle>
          <DialogDescription>
            {progress
              ? `Processing ${progress.processed} of ${progress.total} emails`
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
                  ? "bg-gray-50"
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
                  <span className="text-gray-500">−</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {item.fromName || item.fromEmail}
                </div>
                {item.status === "processing" && (
                  <div className="text-xs text-blue-600">
                    Analyzing with AI...
                  </div>
                )}
                {item.status === "success" && item.categoryName && (
                  <div className="text-xs text-green-600">
                    Moved to &quot;{item.categoryName}&quot;
                  </div>
                )}
                {item.status === "failed" && (
                  <div className="text-xs text-gray-500">
                    Could not match to any category
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {progress && (
          <div className="flex gap-4 text-sm pt-2 border-t">
            <span className="text-green-600">
              ✓ {progress.succeeded} categorized
            </span>
            <span className="text-gray-500">
              − {progress.failed} still uncategorized
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
