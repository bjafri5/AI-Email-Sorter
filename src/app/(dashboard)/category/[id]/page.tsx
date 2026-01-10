import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { EmailList } from "@/components/email-list";

interface CategoryPageProps {
  params: Promise<{ id: string }>;
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const session = await getSession();
  const { id } = await params;

  if (!session?.user?.id) {
    redirect("/login");
  }

  const category = await prisma.category.findFirst({
    where: {
      id,
      userId: session.user.id,
    },
  });

  if (!category) {
    redirect("/dashboard");
  }

  const emails = await prisma.email.findMany({
    where: { categoryId: id },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      gmailId: true,
      subject: true,
      fromEmail: true,
      fromName: true,
      summary: true,
      receivedAt: true,
      unsubscribeLink: true,
      account: {
        select: { id: true },
      },
    },
  });

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to Dashboard
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">{category.name}</h1>
        <p className="text-gray-500">{category.description}</p>
        <p className="text-sm text-gray-400 mt-1">{emails.length} emails</p>
      </div>

      <EmailList emails={emails} categoryId={id} />
    </div>
  );
}
