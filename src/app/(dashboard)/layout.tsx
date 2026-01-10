import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { SignOutButton } from "@/components/sign-out-button";
import { SyncButton } from "@/components/sync-button";
import Link from "next/link";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const totalEmails = await prisma.email.count({
    where: { account: { userId: session.user.id } },
  });

  const lastSync = await prisma.account.findFirst({
    where: { userId: session.user.id, lastSyncedAt: { not: null } },
    orderBy: { lastSyncedAt: "desc" },
    select: { lastSyncedAt: true },
  });

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 max-w-4xl flex justify-between items-center">
          <Link href="/dashboard">
            <h1 className="text-xl font-bold">Email Sorter</h1>
          </Link>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-500 text-right">
              <div>{totalEmails} emails</div>
              {lastSync?.lastSyncedAt && (
                <div className="text-xs">
                  Last sync: {new Date(lastSync.lastSyncedAt).toLocaleString()}
                </div>
              )}
            </div>
            <SyncButton />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
