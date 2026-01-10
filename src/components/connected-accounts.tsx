"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Account {
  id: string;
  email: string | null;
  provider: string;
  providerAccountId: string;
}

interface ConnectedAccountsProps {
  accounts: Account[];
}

export function ConnectedAccounts({ accounts }: ConnectedAccountsProps) {
  const handleConnectAccount = () => {
    signIn("google", { callbackUrl: "/dashboard" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected Gmail Accounts</CardTitle>
        <CardDescription>
          Manage your connected Gmail accounts for email sorting
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {accounts.length === 0 ? (
            <p className="text-gray-500 text-sm">No accounts connected yet.</p>
          ) : (
            accounts.map((account) => (
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
                  <span className="font-medium">
                    {account.email || `Google Account`}
                  </span>
                </div>
                <span className="text-xs text-gray-400 capitalize">
                  {account.provider}
                </span>
              </div>
            ))
          )}
        </div>
        <Button onClick={handleConnectAccount} className="mt-4 w-full">
          Connect Another Gmail Account
        </Button>
      </CardContent>
    </Card>
  );
}
