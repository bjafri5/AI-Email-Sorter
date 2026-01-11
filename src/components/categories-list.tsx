"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AddCategoryDialog } from "@/components/add-category-dialog";

interface Category {
  id: string;
  name: string;
  description: string;
  _count: {
    emails: number;
  };
}

interface CategoriesListProps {
  categories: Category[];
  uncategorizedCount: number;
}

export function CategoriesList({ categories, uncategorizedCount }: CategoriesListProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Categories</CardTitle>
            <CardDescription>
              Define categories to automatically sort your emails
            </CardDescription>
          </div>
          <Button onClick={() => setIsDialogOpen(true)}>Add Category</Button>
        </div>
      </CardHeader>
      <CardContent>
        {categories.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">
              No categories yet. Create one to get started!
            </p>
            <Button variant="outline" onClick={() => setIsDialogOpen(true)}>
              Create Your First Category
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/category/${category.id}`}
                className="block p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium">{category.name}</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      {category.description}
                    </p>
                  </div>
                  <span className="text-sm text-gray-400">
                    {category._count.emails} emails
                  </span>
                </div>
              </Link>
            ))}
            {uncategorizedCount > 0 && (
              <Link
                href="/category/uncategorized"
                className="block p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border-dashed border-2 border-gray-200"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium text-gray-600">Uncategorized</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Emails that couldn&apos;t be matched to any category
                    </p>
                  </div>
                  <span className="text-sm text-gray-400">
                    {uncategorizedCount} emails
                  </span>
                </div>
              </Link>
            )}
          </div>
        )}

        <AddCategoryDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
      </CardContent>
    </Card>
  );
}
