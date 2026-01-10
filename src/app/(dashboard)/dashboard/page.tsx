import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { ConnectedAccounts } from "@/components/connected-accounts";
import { CategoriesList } from "@/components/categories-list";

export default async function DashboardPage() {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const accounts = await prisma.account.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      email: true,
      provider: true,
      providerAccountId: true,
    },
  });

  const categories = await prisma.category.findMany({
    where: { userId: session.user.id },
    include: { _count: { select: { emails: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-8">
      <p className="text-gray-500">
        Welcome, {session.user.name || session.user.email}
      </p>
      <ConnectedAccounts accounts={accounts} />
      <CategoriesList categories={categories} />
    </div>
  );
}
