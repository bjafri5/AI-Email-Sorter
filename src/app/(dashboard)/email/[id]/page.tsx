import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

interface EmailPageProps {
  params: Promise<{ id: string }>;
}

export default async function EmailPage({ params }: EmailPageProps) {
  const session = await getSession();
  const { id } = await params;

  if (!session?.user?.id) {
    redirect("/login");
  }

  const email = await prisma.email.findFirst({
    where: {
      id,
      account: {
        userId: session.user.id,
      },
    },
    include: {
      category: true,
    },
  });

  if (!email) {
    redirect("/dashboard");
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <Link
          href={
            email.categoryId ? `/category/${email.categoryId}` : "/dashboard"
          }
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to {email.category?.name || "Dashboard"}
        </Link>
      </div>

      <div className="bg-white border rounded-lg p-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold mb-2">{email.subject}</h1>
          <div className="text-sm text-gray-500 space-y-1">
            <p>
              <span className="font-medium">From:</span>{" "}
              {email.fromName
                ? `${email.fromName} <${email.fromEmail}>`
                : email.fromEmail}
            </p>
            <p>
              <span className="font-medium">Date:</span>{" "}
              {new Date(email.receivedAt).toLocaleString()}
            </p>
            {email.category && (
              <p>
                <span className="font-medium">Category:</span>{" "}
                {email.category.name}
              </p>
            )}
          </div>
        </div>

        {email.summary && (
          <div className="mb-6 p-4 bg-blue-50 rounded-lg">
            <p className="text-sm font-medium text-blue-900 mb-1">AI Summary</p>
            <p className="text-sm text-blue-800">{email.summary}</p>
          </div>
        )}

        {email.unsubscribeLink && (
          <div className="mb-6 p-4 bg-yellow-50 rounded-lg">
            <p className="text-sm font-medium text-yellow-900 mb-1">
              Unsubscribe Link
            </p>
            <a
              href={email.unsubscribeLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-yellow-800 underline break-all"
            >
              {email.unsubscribeLink}
            </a>
          </div>
        )}

        <div className="border-t pt-6">
          <p className="text-sm font-medium text-gray-700 mb-3">
            Original Content
          </p>
          <iframe
            srcDoc={email.body}
            className="w-full min-h-[600px] border rounded"
            sandbox="allow-same-origin"
            title="Email content"
          />
        </div>
      </div>
    </div>
  );
}
