import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { HeaderControls } from "@/components/header-controls";
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
        <div className="px-6 py-4 flex justify-between items-center">
          <Link href="/dashboard">
            <h1 className="text-xl font-bold">AI Email Sorter</h1>
          </Link>
          <HeaderControls
            totalEmails={totalEmails}
            lastSyncedAt={lastSync?.lastSyncedAt ?? null}
          />
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
