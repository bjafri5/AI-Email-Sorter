import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

// GET /api/categories/[id] - Get a single category
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  const { id } = await params;

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const category = await prisma.category.findFirst({
    where: { id, userId: session.user.id },
    include: {
      emails: {
        orderBy: { receivedAt: "desc" },
      },
    },
  });

  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  return NextResponse.json(category);
}

// PATCH /api/categories/[id] - Update a category
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  const { id } = await params;

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, description } = body;

  const category = await prisma.category.updateMany({
    where: { id, userId: session.user.id },
    data: {
      ...(name && { name }),
      ...(description && { description }),
    },
  });

  if (category.count === 0) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/categories/[id] - Delete a category
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  const { id } = await params;

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify the category belongs to the user
  const category = await prisma.category.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  // Move all emails in this category to uncategorized (set categoryId to null)
  await prisma.email.updateMany({
    where: { categoryId: id },
    data: { categoryId: null },
  });

  // Now delete the category
  await prisma.category.delete({
    where: { id },
  });

  return NextResponse.json({ success: true });
}
