"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import Link from "next/link";
import { friendlyUnsubscribeErrorMessage } from "@/lib/error-messages";
import {
  UnsubscribeProgressModal,
  ProgressLogItem,
} from "@/components/unsubscribe-progress-modal";
import {
  RecategorizeProgressModal,
  RecategorizeProgressLogItem,
} from "@/components/recategorize-progress-modal";

interface Email {
  id: string;
  gmailId: string;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  summary: string | null;
  receivedAt: Date;
  unsubscribeLink: string | null;
  unsubscribeStatus: string | null;
  account: { id: string; email: string | null };
}

interface EmailListProps {
  emails: Email[];
  categoryId: string | null;
  isUncategorized?: boolean;
}

interface UnsubscribeResult {
  emailId: string;
  fromEmail: string;
  success: boolean;
  method: string;
  message: string;
}

const EMAILS_PER_PAGE = 50;

export function EmailList({
  emails,
  categoryId,
  isUncategorized = false,
}: EmailListProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUnsubscribing, setIsUnsubscribing] = useState(false);
  const [isRecategorizing, setIsRecategorizing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "delete" | "unsubscribe" | "recategorize" | null
  >(null);

  // Results modal state
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [unsubscribeResults, setUnsubscribeResults] = useState<
    UnsubscribeResult[]
  >([]);

  // Progress modal state
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [unsubscribeProgress, setUnsubscribeProgress] = useState<{
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
    current?: string;
  } | null>(null);
  const [progressLog, setProgressLog] = useState<ProgressLogItem[]>([]);


  const [recategorizeProgress, setRecategorizeProgress] = useState<{
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
  } | null>(null);

  // Recategorize progress modal state
  const [showRecategorizeProgressModal, setShowRecategorizeProgressModal] =
    useState(false);
  const [recategorizeProgressLog, setRecategorizeProgressLog] = useState<
    RecategorizeProgressLogItem[]
  >([]);

  // Recategorize results modal state
  const [showRecategorizeResultsModal, setShowRecategorizeResultsModal] =
    useState(false);
  const [recategorizeResults, setRecategorizeResults] = useState<
    Array<{
      emailId: string;
      fromEmail: string;
      fromName: string | null;
      success: boolean;
      categoryName: string | null;
    }>
  >([]);

  // Pagination - calculate early so we can use paginatedEmails in toggleAll
  const totalPages = Math.ceil(emails.length / EMAILS_PER_PAGE);
  const startIndex = (currentPage - 1) * EMAILS_PER_PAGE;
  const endIndex = startIndex + EMAILS_PER_PAGE;
  const paginatedEmails = emails.slice(startIndex, endIndex);

  // Check if all emails on current page are selected
  const allOnPageSelected =
    paginatedEmails.length > 0 &&
    paginatedEmails.every((e) => selectedIds.has(e.id));

  const toggleAll = () => {
    if (allOnPageSelected) {
      // Deselect all on current page
      const newSet = new Set(selectedIds);
      paginatedEmails.forEach((e) => newSet.delete(e.id));
      setSelectedIds(newSet);
    } else {
      // Select all on current page (keep existing selections from other pages)
      const newSet = new Set(selectedIds);
      paginatedEmails.forEach((e) => newSet.add(e.id));
      setSelectedIds(newSet);
    }
  };

  const toggleOne = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const openConfirmModal = (
    action: "delete" | "unsubscribe" | "recategorize"
  ) => {
    setConfirmAction(action);
    setShowConfirmModal(true);
  };

  const handleConfirm = async () => {
    setShowConfirmModal(false);
    if (confirmAction === "delete") {
      await performDelete();
    } else if (confirmAction === "unsubscribe") {
      await performUnsubscribe();
    } else if (confirmAction === "recategorize") {
      await performRecategorize();
    }
    setConfirmAction(null);
  };

  const performDelete = async () => {
    if (selectedIds.size === 0) return;

    setIsDeleting(true);

    try {
      const response = await fetch("/api/emails/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds: Array.from(selectedIds) }),
      });

      if (!response.ok) throw new Error("Failed to delete emails");

      setSelectedIds(new Set());
      router.refresh();
    } catch (error) {
      console.error("Delete error:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const performUnsubscribe = async () => {
    if (selectedIds.size === 0) return;

    // Get the selected emails' info for the progress log
    const selectedEmails = emails.filter((e) => selectedIds.has(e.id));
    const initialLog = selectedEmails.map((e) => ({
      emailId: e.id,
      fromEmail: e.fromEmail,
      status: "pending" as const,
    }));

    setIsUnsubscribing(true);
    setProgressLog(initialLog);
    setShowProgressModal(true);
    setUnsubscribeProgress({
      total: selectedIds.size,
      processed: 0,
      succeeded: 0,
      failed: 0,
    });

    try {
      // Send email IDs in the order they appear in the UI
      const orderedEmailIds = selectedEmails.map((e) => e.id);
      const response = await fetch("/api/emails/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds: orderedEmailIds }),
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
              // Mark current email as processing (by unique emailId)
              setProgressLog((prev) =>
                prev.map((item) =>
                  item.emailId === data.currentId
                    ? { ...item, status: "processing" }
                    : item
                )
              );
              setUnsubscribeProgress({
                total: data.total,
                processed: data.processed,
                succeeded: data.succeeded,
                failed: data.failed,
                current: data.current,
              });
            }

            if (data.type === "progress" && data.result) {
              // Update the completed email's status (by unique emailId)
              setProgressLog((prev) =>
                prev.map((item) =>
                  item.emailId === data.result.emailId
                    ? {
                        ...item,
                        status: data.result.success ? "success" : "failed",
                        message: data.result.message,
                      }
                    : item
                )
              );
              setUnsubscribeProgress({
                total: data.total,
                processed: data.processed,
                succeeded: data.succeeded,
                failed: data.failed,
                current: data.current,
              });
            }

            if (data.type === "complete") {
              setUnsubscribeResults(data.results);
              // Keep progress modal open briefly, then switch to results
              setTimeout(() => {
                setShowProgressModal(false);
                setShowResultsModal(true);
              }, 500);
            }
          }
        }
      }
    } catch (error) {
      console.error("Unsubscribe error:", error);
      setShowProgressModal(false);
    } finally {
      setIsUnsubscribing(false);
      setSelectedIds(new Set());
      setUnsubscribeProgress(null);
      router.refresh();
    }
  };

  const performRecategorize = async () => {
    if (selectedIds.size === 0) return;

    // Get the selected emails' info for the progress log
    const selectedEmails = emails.filter((e) => selectedIds.has(e.id));
    const initialLog: RecategorizeProgressLogItem[] = selectedEmails.map(
      (e) => ({
        emailId: e.id,
        fromEmail: e.fromEmail,
        fromName: e.fromName,
        status: "pending" as const,
      })
    );

    setIsRecategorizing(true);
    setRecategorizeProgressLog(initialLog);
    setShowRecategorizeProgressModal(true);
    setRecategorizeProgress({
      total: selectedIds.size,
      processed: 0,
      succeeded: 0,
      failed: 0,
    });

    try {
      const response = await fetch("/api/emails/recategorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds: Array.from(selectedIds) }),
      });

      if (!response.ok) throw new Error("Failed to recategorize emails");

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
              // Mark current email as processing (by unique emailId)
              setRecategorizeProgressLog((prev) =>
                prev.map((item) =>
                  item.emailId === data.currentId
                    ? { ...item, status: "processing" }
                    : item
                )
              );
              setRecategorizeProgress({
                total: data.total,
                processed: data.processed,
                succeeded: data.succeeded,
                failed: data.failed,
              });
            }

            if (data.type === "progress" && data.result) {
              // Update the completed email's status (by unique emailId)
              setRecategorizeProgressLog((prev) =>
                prev.map((item) =>
                  item.emailId === data.result.emailId
                    ? {
                        ...item,
                        status: data.result.success ? "success" : "failed",
                        categoryName: data.result.categoryName,
                      }
                    : item
                )
              );
              setRecategorizeProgress({
                total: data.total,
                processed: data.processed,
                succeeded: data.succeeded,
                failed: data.failed,
              });
            }

            if (data.type === "complete") {
              setRecategorizeResults(data.results);
              // Keep progress modal open briefly, then switch to results
              setTimeout(() => {
                setShowRecategorizeProgressModal(false);
                setShowRecategorizeResultsModal(true);
              }, 500);
            }
          }
        }
      }

      setSelectedIds(new Set());
      router.refresh();
    } catch (error) {
      console.error("Recategorize error:", error);
      setShowRecategorizeProgressModal(false);
    } finally {
      setIsRecategorizing(false);
      setRecategorizeProgress(null);
    }
  };

  const succeededCount = unsubscribeResults.filter((r) => r.success).length;
  const failedCount = unsubscribeResults.filter((r) => !r.success).length;

  const recategorizeSucceededCount = recategorizeResults.filter(
    (r) => r.success
  ).length;
  const recategorizeFailedCount = recategorizeResults.filter(
    (r) => !r.success
  ).length;

  if (emails.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No emails in this category yet.
      </div>
    );
  }

  return (
    <div>
      {/* Confirmation Modal */}
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "delete"
                ? "Delete Emails"
                : confirmAction === "recategorize"
                ? "Recategorize Emails"
                : "Unsubscribe"}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === "delete"
                ? `Are you sure you want to delete ${selectedIds.size} email(s)? This will move them to trash in Gmail.`
                : confirmAction === "recategorize"
                ? `Are you sure you want to recategorize ${selectedIds.size} email(s)? This will use AI to attempt to classify them into your categories.`
                : `Are you sure you want to unsubscribe from ${selectedIds.size} email(s)? This will attempt to unsubscribe you from these senders.`}
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
              {confirmAction === "delete"
                ? "Delete"
                : confirmAction === "recategorize"
                ? "Recategorize"
                : "Unsubscribe"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UnsubscribeProgressModal
        open={showProgressModal}
        progressLog={progressLog}
        progress={unsubscribeProgress}
      />

      <RecategorizeProgressModal
        open={showRecategorizeProgressModal}
        progressLog={recategorizeProgressLog}
        progress={recategorizeProgress}
      />

      {/* Results Modal */}
      <Dialog open={showResultsModal} onOpenChange={setShowResultsModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Unsubscribe Results</DialogTitle>
          </DialogHeader>

          {unsubscribeResults.length === 0 ? (
            <p className="text-gray-500">
              None of the selected emails have unsubscribe links, or they've
              already been unsubscribed.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-4 text-sm">
                <span className="text-green-600">
                  ✓ {succeededCount} succeeded
                </span>
                <span className="text-red-600">✗ {failedCount} failed</span>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-2">
                {unsubscribeResults.map((result, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded text-sm ${
                      result.success ? "bg-green-50" : "bg-red-50"
                    }`}
                  >
                    <div className="font-medium">
                      {result.success ? "✓" : "✗"} {result.fromEmail}
                    </div>
                    <div className="text-gray-600 text-xs mt-1">
                      {result.success
                        ? "Unsubscribed successfully"
                        : friendlyUnsubscribeErrorMessage(result.message)}
                    </div>
                  </div>
                ))}
              </div>

              {failedCount > 0 && (
                <p className="text-xs text-gray-500">
                  For continuous failed unsubscribes, you may need to
                  unsubscribe manually by clicking the link in the original
                  email.
                </p>
              )}
            </div>
          )}

          <Button
            onClick={() => {
              setShowResultsModal(false);
              setProgressLog([]);
            }}
            className="mt-4"
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>

      {/* Recategorize Results Modal */}
      <Dialog
        open={showRecategorizeResultsModal}
        onOpenChange={setShowRecategorizeResultsModal}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Recategorize Results</DialogTitle>
          </DialogHeader>

          {recategorizeResults.length === 0 ? (
            <p className="text-gray-500">No emails were processed.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-4 text-sm">
                <span className="text-green-600">
                  ✓ {recategorizeSucceededCount} categorized
                </span>
                <span className="text-gray-500">
                  − {recategorizeFailedCount} still uncategorized
                </span>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-2">
                {recategorizeResults.map((result, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded text-sm ${
                      result.success ? "bg-green-50" : "bg-gray-50"
                    }`}
                  >
                    <div className="font-medium">
                      {result.success ? "✓" : "−"}{" "}
                      {result.fromName || result.fromEmail}
                    </div>
                    <div className="text-gray-600 text-xs mt-1">
                      {result.success
                        ? `Moved to "${result.categoryName}"`
                        : "Could not match to any category"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button
            onClick={() => setShowRecategorizeResultsModal(false)}
            className="mt-4"
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>

      {/* Bulk Actions Bar */}
      <div className="flex items-center gap-4 mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2">
          <Checkbox
            id="select-all"
            checked={allOnPageSelected}
            onCheckedChange={toggleAll}
          />
          <label htmlFor="select-all" className="text-sm">
            Select All ({paginatedEmails.length})
          </label>
        </div>

        {selectedIds.size > 0 && (
          <>
            <span className="text-sm text-gray-500">
              {selectedIds.size} selected
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => openConfirmModal("delete")}
              disabled={isDeleting || isUnsubscribing || isRecategorizing}
            >
              {isDeleting ? "Deleting..." : `Delete (${selectedIds.size})`}
            </Button>
            <Button
              onClick={() => openConfirmModal("unsubscribe")}
              disabled={isDeleting || isUnsubscribing || isRecategorizing}
            >
              {isUnsubscribing
                ? `Unsubscribed ${unsubscribeProgress?.processed || 0}/${
                    unsubscribeProgress?.total || 0
                  }...`
                : `Unsubscribe (${selectedIds.size})`}
            </Button>
            {isUncategorized && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openConfirmModal("recategorize")}
                disabled={isDeleting || isUnsubscribing || isRecategorizing}
              >
                {isRecategorizing
                  ? `Recategorizing ${recategorizeProgress?.processed || 0}/${
                      recategorizeProgress?.total || 0
                    }...`
                  : `Recategorize (${selectedIds.size})`}
              </Button>
            )}
          </>
        )}
      </div>

      {/* Email List */}
      <div className="max-h-[600px] overflow-y-auto border rounded-lg">
        <div className="space-y-2 p-2">
          {paginatedEmails.map((email) => (
            <div
              key={email.id}
              className={`flex items-start gap-3 p-4 border rounded-lg hover:bg-gray-50 ${
                email.unsubscribeStatus === "success"
                  ? "bg-gray-50"
                  : "bg-white"
              }`}
            >
              <Checkbox
                checked={selectedIds.has(email.id)}
                onCheckedChange={() => toggleOne(email.id)}
                className="mt-1"
              />

              <Link href={`/email/${email.id}`} className="flex-1 min-w-0">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">
                        {email.fromName || email.fromEmail}
                      </p>
                      {email.unsubscribeStatus === "success" && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                          Unsubscribed
                        </span>
                      )}
                      {email.unsubscribeStatus === "failed" && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                          Unsub failed
                        </span>
                      )}
                      {!email.unsubscribeStatus && email.unsubscribeLink && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                          Can unsubscribe
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-900 truncate">
                      {email.subject}
                    </p>
                    <p className="text-sm text-gray-500 line-clamp-2 mt-1">
                      {email.summary}
                    </p>
                  </div>
                  <div className="text-xs text-gray-400 whitespace-nowrap text-right">
                    <div>{new Date(email.receivedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</div>
                    {email.account.email && (
                      <div
                        className="mt-1 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full truncate max-w-[200px]"
                        title={email.account.email}
                      >
                        {email.account.email}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
          <div className="text-xs sm:text-sm text-gray-500">
            {startIndex + 1}-{Math.min(endIndex, emails.length)} of {emails.length}
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="hidden sm:inline-flex"
            >
              First
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Prev
            </Button>
            <span className="text-xs sm:text-sm px-2 sm:px-3">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="hidden sm:inline-flex"
            >
              Last
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
