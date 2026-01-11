import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { EmailList } from "@/components/email-list";
import { CategoryHeader } from "@/components/category-header";

interface CategoryPageProps {
  params: Promise<{ id: string }>;
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const session = await getSession();
  const { id } = await params;

  if (!session?.user?.id) {
    redirect("/login");
  }

  const isUncategorized = id === "uncategorized";

  let categoryName: string;
  let categoryDescription: string;

  if (isUncategorized) {
    categoryName = "Uncategorized";
    categoryDescription = "Emails that couldn't be matched to any category";
  } else {
    const category = await prisma.category.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    });

    if (!category) {
      redirect("/dashboard");
    }

    categoryName = category.name;
    categoryDescription = category.description;
  }

  const emails = await prisma.email.findMany({
    where: isUncategorized
      ? { account: { userId: session.user.id }, categoryId: null }
      : { categoryId: id },
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
      unsubscribeStatus: true,
      account: {
        select: { id: true, email: true },
      },
    },
  });

  return (
    <div className="container mx-auto px-4 py-4 max-w-6xl">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {isUncategorized ? (
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{categoryName}</h1>
          <p className="text-gray-500">{categoryDescription}</p>
          <p className="text-sm text-gray-400 mt-1">{emails.length} emails</p>
        </div>
      ) : (
        <CategoryHeader
          categoryId={id}
          categoryName={categoryName}
          categoryDescription={categoryDescription}
          emailCount={emails.length}
        />
      )}

      <EmailList
        emails={emails}
        categoryId={isUncategorized ? null : id}
        isUncategorized={isUncategorized}
      />
    </div>
  );
}
