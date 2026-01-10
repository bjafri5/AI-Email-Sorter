"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";

interface Email {
  id: string;
  gmailId: string;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  summary: string | null;
  receivedAt: Date;
  unsubscribeLink: string | null;
  account: { id: string };
}

interface EmailListProps {
  emails: Email[];
  categoryId: string;
}

export function EmailList({ emails, categoryId }: EmailListProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUnsubscribing, setIsUnsubscribing] = useState(false);

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

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;

    if (
      !confirm(
        `Delete ${selectedIds.size} email(s)? This will move them to trash in Gmail.`
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch("/api/emails/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds: Array.from(selectedIds) }),
      });

      if (!response.ok) {
        throw new Error("Failed to delete emails");
      }

      setSelectedIds(new Set());
      router.refresh();
    } catch (error) {
      alert(`Error: ${error}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUnsubscribe = async () => {
    if (selectedIds.size === 0) return;

    const selectedEmails = emails.filter((e) => selectedIds.has(e.id));
    const withUnsubscribe = selectedEmails.filter((e) => e.unsubscribeLink);

    if (withUnsubscribe.length === 0) {
      alert("None of the selected emails have unsubscribe links.");
      return;
    }

    if (!confirm(`Unsubscribe from ${withUnsubscribe.length} email(s)?`)) {
      return;
    }

    setIsUnsubscribing(true);
    try {
      const response = await fetch("/api/emails/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds: Array.from(selectedIds) }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to unsubscribe");
      }

      alert(
        `Unsubscribe attempted for ${data.processed} email(s). Success: ${data.succeeded}, Failed: ${data.failed}`
      );
      setSelectedIds(new Set());
      router.refresh();
    } catch (error) {
      alert(`Error: ${error}`);
    } finally {
      setIsUnsubscribing(false);
    }
  };

  if (emails.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No emails in this category yet.
      </div>
    );
  }

  return (
    <div>
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
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleUnsubscribe}
              disabled={isUnsubscribing}
            >
              {isUnsubscribing ? "Unsubscribing..." : "Unsubscribe"}
            </Button>
          </>
        )}
      </div>

      {/* Email List */}
      <div className="space-y-2">
        {emails.map((email) => (
          <div
            key={email.id}
            className="flex items-start gap-3 p-4 bg-white border rounded-lg hover:bg-gray-50"
          >
            <Checkbox
              checked={selectedIds.has(email.id)}
              onCheckedChange={() => toggleOne(email.id)}
              className="mt-1"
            />

            <Link href={`/email/${email.id}`} className="flex-1 min-w-0">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">
                    {email.fromName || email.fromEmail}
                  </p>
                  <p className="text-sm text-gray-900 truncate">
                    {email.subject}
                  </p>
                  <p className="text-sm text-gray-500 line-clamp-2 mt-1">
                    {email.summary}
                  </p>
                </div>
                <div className="text-xs text-gray-400 whitespace-nowrap">
                  {new Date(email.receivedAt).toLocaleDateString()}
                </div>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
