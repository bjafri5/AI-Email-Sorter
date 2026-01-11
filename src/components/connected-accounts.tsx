"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Account {
  id: string;
  email: string | null;
  provider: string;
  providerAccountId: string;
}

interface ConnectedAccountsProps {
  accounts: Account[];
  userEmail: string | null | undefined;
}

export function ConnectedAccounts({ accounts, userEmail }: ConnectedAccountsProps) {
  const router = useRouter();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [accountToRemove, setAccountToRemove] = useState<Account | null>(null);

  const handleConnectAccount = () => {
    signIn("google", { callbackUrl: "/dashboard" });
  };

  const openRemoveModal = (account: Account) => {
    setAccountToRemove(account);
    setShowConfirmModal(true);
  };

  const handleRemoveAccount = async () => {
    if (!accountToRemove) return;

    setShowConfirmModal(false);
    setRemovingId(accountToRemove.id);

    try {
      const response = await fetch(`/api/accounts/${accountToRemove.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        alert(data.error || "Failed to remove account");
        return;
      }

      router.refresh();
    } catch (error) {
      console.error("Error removing account:", error);
      alert("Failed to remove account");
    } finally {
      setRemovingId(null);
      setAccountToRemove(null);
    }
  };

  const isPrimaryAccount = (account: Account) => account.email === userEmail;

  // Sort accounts so primary account is always first
  const sortedAccounts = [...accounts].sort((a, b) => {
    if (isPrimaryAccount(a)) return -1;
    if (isPrimaryAccount(b)) return 1;
    return 0;
  });

  return (
    <>
      <Dialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {accountToRemove?.email || "this account"}?
              All emails synced from this account will be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowConfirmModal(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRemoveAccount}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Connected Gmail Accounts</CardTitle>
          <CardDescription>
            Manage your connected Gmail accounts for email sorting
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sortedAccounts.length === 0 ? (
              <p className="text-gray-500 text-sm">No accounts connected yet.</p>
            ) : (
              sortedAccounts.map((account) => {
                const isPrimary = isPrimaryAccount(account);
                return (
                  <div
                    key={account.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <span className="text-blue-600 text-sm font-medium">
                          {(account.email || "G")[0].toUpperCase()}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {account.email || `Google Account`}
                        </span>
                        {isPrimary && (
                          <span className="text-xs text-gray-400">Primary</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isPrimary && sortedAccounts.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openRemoveModal(account)}
                          disabled={removingId === account.id}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          {removingId === account.id ? "Removing..." : "Remove"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <Button onClick={handleConnectAccount} className="mt-4 w-full">
            Connect Another Gmail Account
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
