"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { friendlyUnsubscribeErrorMessage } from "@/lib/error-messages";
import {
  UnsubscribeProgressModal,
  ProgressLogItem,
} from "@/components/unsubscribe-progress-modal";

interface EmailActionsProps {
  emailId: string;
  fromEmail: string;
  unsubscribeLink: string | null;
  unsubscribeStatus: string | null;
  categoryId: string | null;
}

interface UnsubscribeResult {
  success: boolean;
  message: string;
}

export function EmailActions({
  emailId,
  fromEmail,
  unsubscribeLink,
  unsubscribeStatus,
  categoryId,
}: EmailActionsProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUnsubscribing, setIsUnsubscribing] = useState(false);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "delete" | "unsubscribe" | null
  >(null);

  const [showResultModal, setShowResultModal] = useState(false);
  const [unsubscribeResult, setUnsubscribeResult] =
    useState<UnsubscribeResult | null>(null);

  // Progress modal state
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [progressLog, setProgressLog] = useState<ProgressLogItem[]>([]);
  const [unsubscribeProgress, setUnsubscribeProgress] = useState<{
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
  } | null>(null);

  const openConfirmModal = (action: "delete" | "unsubscribe") => {
    setConfirmAction(action);
    setShowConfirmModal(true);
  };

  const handleConfirm = async () => {
    setShowConfirmModal(false);
    if (confirmAction === "delete") {
      await performDelete();
    } else if (confirmAction === "unsubscribe") {
      await performUnsubscribe();
    }
    setConfirmAction(null);
  };

  const performDelete = async () => {
    setIsDeleting(true);

    try {
      const response = await fetch("/api/emails/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds: [emailId] }),
      });

      if (!response.ok) throw new Error("Failed to delete email");

      // Consume the SSE stream
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }

      // Navigate back to category or dashboard
      if (categoryId) {
        router.push(`/category/${categoryId}`);
      } else {
        router.push("/dashboard");
      }
      router.refresh();
    } catch (error) {
      console.error("Delete error:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const performUnsubscribe = async () => {
    setIsUnsubscribing(true);
    setProgressLog([{ emailId, fromEmail, status: "pending" }]);
    setShowProgressModal(true);
    setUnsubscribeProgress({
      total: 1,
      processed: 0,
      succeeded: 0,
      failed: 0,
    });

    try {
      const response = await fetch("/api/emails/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds: [emailId] }),
      });

      if (!response.ok) throw new Error("Failed to start unsubscribe");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));

            if (data.type === "processing") {
              setProgressLog([{ emailId, fromEmail, status: "processing" }]);
              setUnsubscribeProgress({
                total: 1,
                processed: 0,
                succeeded: 0,
                failed: 0,
              });
            }

            if (data.type === "progress" && data.result) {
              setProgressLog([
                {
                  emailId,
                  fromEmail,
                  status: data.result.success ? "success" : "failed",
                  message: data.result.message,
                },
              ]);
              setUnsubscribeProgress({
                total: 1,
                processed: 1,
                succeeded: data.result.success ? 1 : 0,
                failed: data.result.success ? 0 : 1,
              });
            }

            if (data.type === "complete" && data.results?.length > 0) {
              const result = data.results[0];
              setUnsubscribeResult({
                success: result.success,
                message: result.message,
              });
              // Transition from progress modal to result modal
              setTimeout(() => {
                setShowProgressModal(false);
                setShowResultModal(true);
              }, 500);
            }
          }
        }
      }

      router.refresh();
    } catch (error) {
      console.error("Unsubscribe error:", error);
      setShowProgressModal(false);
      setUnsubscribeResult({
        success: false,
        message: String(error),
      });
      setShowResultModal(true);
    } finally {
      setIsUnsubscribing(false);
      setUnsubscribeProgress(null);
    }
  };

  const canUnsubscribe = unsubscribeLink && unsubscribeStatus !== "success";

  return (
    <>
      {/* Confirmation Modal */}
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "delete" ? "Delete Email" : "Unsubscribe"}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === "delete"
                ? "Are you sure you want to delete this email? This will move it to trash in Gmail."
                : `Are you sure you want to unsubscribe from ${fromEmail}?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowConfirmModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant={confirmAction === "delete" ? "destructive" : "default"}
              onClick={handleConfirm}
            >
              {confirmAction === "delete" ? "Delete" : "Unsubscribe"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnsubscribeProgressModal
        open={showProgressModal}
        progressLog={progressLog}
        progress={unsubscribeProgress}
      />

      {/* Unsubscribe Result Modal */}
      <Dialog open={showResultModal} onOpenChange={setShowResultModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsubscribe Result</DialogTitle>
          </DialogHeader>
          {unsubscribeResult && (
            <div
              className={`p-4 rounded ${
                unsubscribeResult.success ? "bg-green-50" : "bg-red-50"
              }`}
            >
              <p
                className={`font-medium ${
                  unsubscribeResult.success ? "text-green-800" : "text-red-800"
                }`}
              >
                {unsubscribeResult.success ? "Success!" : "Failed"}
              </p>
              <p
                className={`text-sm mt-1 ${
                  unsubscribeResult.success ? "text-green-700" : "text-red-700"
                }`}
              >
                {unsubscribeResult.success
                  ? "Successfully unsubscribed from this sender."
                  : friendlyUnsubscribeErrorMessage(unsubscribeResult.message)}
              </p>
            </div>
          )}
          <Button
            onClick={() => {
              setShowResultModal(false);
              setProgressLog([]);
            }}
            className="mt-2"
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>

      {/* Action Buttons */}
      <div className="flex gap-2">
        {canUnsubscribe && (
          <Button
            onClick={() => openConfirmModal("unsubscribe")}
            disabled={isUnsubscribing || isDeleting}
          >
            {isUnsubscribing ? "Unsubscribing..." : "Unsubscribe"}
          </Button>
        )}
        {unsubscribeStatus === "success" && (
          <span className="text-sm bg-green-100 text-green-700 px-3 py-2 rounded">
            Unsubscribed
          </span>
        )}
        <Button
          variant="destructive"
          onClick={() => openConfirmModal("delete")}
          disabled={isDeleting || isUnsubscribing}
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </Button>
      </div>
    </>
  );
}
