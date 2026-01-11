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
  categoryId: string;
}

interface UnsubscribeResult {
  emailId: string;
  fromEmail: string;
  success: boolean;
  method: string;
  message: string;
}

export function EmailList({ emails, categoryId }: EmailListProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUnsubscribing, setIsUnsubscribing] = useState(false);

  // Confirmation modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "delete" | "unsubscribe" | null
  >(null);

  // Results modal state
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [unsubscribeResults, setUnsubscribeResults] = useState<
    UnsubscribeResult[]
  >([]);

  const [unsubscribeProgress, setUnsubscribeProgress] = useState<{
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
    current?: string;
  } | null>(null);

  const [deleteProgress, setDeleteProgress] = useState<{
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
  } | null>(null);

  const allSelected = emails.length > 0 && selectedIds.size === emails.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(emails.map((e) => e.id)));
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
    if (selectedIds.size === 0) return;

    setIsDeleting(true);
    setDeleteProgress({
      total: selectedIds.size,
      processed: 0,
      succeeded: 0,
      failed: 0,
    });

    try {
      const response = await fetch("/api/emails/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds: Array.from(selectedIds) }),
      });

      if (!response.ok) throw new Error("Failed to delete emails");

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

            if (data.type === "processing" || data.type === "progress") {
              setDeleteProgress({
                total: data.total,
                processed: data.processed,
                succeeded: data.succeeded,
                failed: data.failed,
              });
            }
          }
        }
      }

      setSelectedIds(new Set());
      router.refresh();
    } catch (error) {
      console.error("Delete error:", error);
    } finally {
      setIsDeleting(false);
      setDeleteProgress(null);
    }
  };

  const performUnsubscribe = async () => {
    if (selectedIds.size === 0) return;

    setIsUnsubscribing(true);
    setUnsubscribeProgress({
      total: selectedIds.size,
      processed: 0,
      succeeded: 0,
      failed: 0,
    });

    try {
      const response = await fetch("/api/emails/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds: Array.from(selectedIds) }),
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

            if (data.type === "processing" || data.type === "progress") {
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
              setShowResultsModal(true);
            }
          }
        }
      }
    } catch (error) {
      console.error("Unsubscribe error:", error);
    } finally {
      setIsUnsubscribing(false);
      setSelectedIds(new Set());
      setUnsubscribeProgress(null);
      router.refresh();
    }
  };

  const succeededCount = unsubscribeResults.filter((r) => r.success).length;
  const failedCount = unsubscribeResults.filter((r) => !r.success).length;

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
              {confirmAction === "delete" ? "Delete Emails" : "Unsubscribe"}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === "delete"
                ? `Are you sure you want to delete ${selectedIds.size} email(s)? This will move them to trash in Gmail.`
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
              {confirmAction === "delete" ? "Delete" : "Unsubscribe"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

          <Button onClick={() => setShowResultsModal(false)} className="mt-4">
            Close
          </Button>
        </DialogContent>
      </Dialog>

      {/* Bulk Actions Bar */}
      <div className="flex items-center gap-4 mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2">
          <Checkbox
            id="select-all"
            checked={allSelected}
            onCheckedChange={toggleAll}
          />
          <label htmlFor="select-all" className="text-sm">
            Select All ({emails.length})
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
              disabled={isDeleting || isUnsubscribing}
            >
              {isDeleting
                ? `Deleted ${deleteProgress?.processed || 0}/${
                    deleteProgress?.total || 0
                  }...`
                : `Delete (${selectedIds.size})`}
            </Button>
            <Button
              onClick={() => openConfirmModal("unsubscribe")}
              disabled={isDeleting || isUnsubscribing}
            >
              {isUnsubscribing
                ? `Unsubscribed ${unsubscribeProgress?.processed || 0}/${
                    unsubscribeProgress?.total || 0
                  }...`
                : `Unsubscribe (${selectedIds.size})`}
            </Button>
          </>
        )}
      </div>

      {/* Email List */}
      <div className="space-y-2">
        {emails.map((email) => (
          <div
            key={email.id}
            className={`flex items-start gap-3 p-4 border rounded-lg hover:bg-gray-50 ${
              email.unsubscribeStatus === "success" ? "bg-gray-50" : "bg-white"
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
                  <div>{new Date(email.receivedAt).toLocaleDateString()}</div>
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
  );
}
