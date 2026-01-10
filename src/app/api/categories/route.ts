import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

// GET /api/categories - List all categories
export async function GET() {
  const session = await getSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const categories = await prisma.category.findMany({
    where: { userId: session.user.id },
    include: {
      _count: {
        select: { emails: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(categories);
}

// POST /api/categories - Create a new category
export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, description } = body;

  if (!name || !description) {
    return NextResponse.json(
      { error: "Name and description are required" },
      { status: 400 }
    );
  }

  const category = await prisma.category.create({
    data: {
      name,
      description,
      userId: session.user.id,
    },
  });

  return NextResponse.json(category, { status: 201 });
}
