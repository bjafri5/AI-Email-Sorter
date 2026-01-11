"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CategoryHeaderProps {
  categoryId: string;
  categoryName: string;
  categoryDescription: string;
  emailCount: number;
}

export function CategoryHeader({
  categoryId,
  categoryName,
  categoryDescription,
  emailCount,
}: CategoryHeaderProps) {
  const router = useRouter();
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/categories/${categoryId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || "Failed to delete category");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      console.error("Error deleting category:", error);
      alert("Failed to delete category");
    } finally {
      setIsDeleting(false);
      setShowConfirmModal(false);
    }
  };

  return (
    <>
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Category</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{categoryName}&quot;?
              {emailCount > 0 && (
                <>
                  {" "}
                  The {emailCount} email{emailCount !== 1 ? "s" : ""} in this
                  category will be moved to Uncategorized.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowConfirmModal(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{categoryName}</h1>
            <p className="text-gray-500">{categoryDescription}</p>
            <p className="text-sm text-gray-400 mt-1">{emailCount} emails</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConfirmModal(true)}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            Delete Category
          </Button>
        </div>
      </div>
    </>
  );
}
