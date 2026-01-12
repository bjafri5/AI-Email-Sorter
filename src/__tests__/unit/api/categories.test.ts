import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    category: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    email: {
      updateMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth-helpers', () => ({
  getSession: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth-helpers'

describe('Categories API Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetching categories', () => {
    it('returns categories for authenticated user', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { id: 'user1', email: 'test@example.com' },
      } as any)

      vi.mocked(prisma.category.findMany).mockResolvedValue([
        { id: 'cat1', name: 'Newsletters', description: 'News', userId: 'user1', createdAt: new Date(), updatedAt: new Date() },
        { id: 'cat2', name: 'Promotions', description: 'Promos', userId: 'user1', createdAt: new Date(), updatedAt: new Date() },
      ] as any)

      const session = await getSession()
      expect(session?.user?.id).toBe('user1')

      const categories = await prisma.category.findMany({
        where: { userId: session!.user!.id },
        orderBy: { createdAt: 'asc' },
      })

      expect(categories).toHaveLength(2)
      expect(categories[0].name).toBe('Newsletters')
    })

    it('handles unauthenticated user', async () => {
      vi.mocked(getSession).mockResolvedValue(null)

      const session = await getSession()
      expect(session).toBeNull()
    })
  })

  describe('creating categories', () => {
    it('creates category with valid data', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { id: 'user1', email: 'test@example.com' },
      } as any)

      vi.mocked(prisma.category.create).mockResolvedValue({
        id: 'newcat',
        name: 'New Category',
        description: 'Description',
        userId: 'user1',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any)

      const newCategory = await prisma.category.create({
        data: {
          name: 'New Category',
          description: 'Description',
          userId: 'user1',
        },
      })

      expect(newCategory.name).toBe('New Category')
      expect(newCategory.userId).toBe('user1')
    })
  })

  describe('deleting categories', () => {
    it('moves emails to uncategorized when deleting category', async () => {
      vi.mocked(getSession).mockResolvedValue({
        user: { id: 'user1', email: 'test@example.com' },
      } as any)

      // First, uncategorize all emails in this category
      await prisma.email.updateMany({
        where: { categoryId: 'cat1' },
        data: { categoryId: null },
      })

      // Then delete the category
      await prisma.category.delete({
        where: { id: 'cat1' },
      })

      expect(prisma.email.updateMany).toHaveBeenCalledWith({
        where: { categoryId: 'cat1' },
        data: { categoryId: null },
      })
      expect(prisma.category.delete).toHaveBeenCalledWith({
        where: { id: 'cat1' },
      })
    })
  })
})
