import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    account: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    category: {
      findMany: vi.fn(),
    },
    email: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/gmail', () => ({
  fetchNewEmails: vi.fn(),
  archiveEmail: vi.fn(),
}))

vi.mock('@/lib/ai', () => ({
  classifyEmail: vi.fn(),
  summarizeEmail: vi.fn(),
}))

vi.mock('@/lib/email-utils', () => ({
  cleanEmailBody: vi.fn((body) => body.replace(/<[^>]+>/g, '')),
}))

import { prisma } from '@/lib/prisma'
import { fetchNewEmails, archiveEmail } from '@/lib/gmail'
import { classifyEmail, summarizeEmail } from '@/lib/ai'
import { cleanEmailBody } from '@/lib/email-utils'
import { syncEmailsForUser } from '@/lib/email-sync'

describe('syncEmailsForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns results for all accounts', async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: 'acc1', email: 'user1@example.com', userId: 'user1' },
      { id: 'acc2', email: 'user2@example.com', userId: 'user1' },
    ] as any)

    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { id: 'cat1', name: 'Newsletters', description: 'News' },
    ] as any)

    vi.mocked(prisma.account.findUnique).mockResolvedValue({
      id: 'acc1',
      lastSyncedAt: null,
    } as any)

    vi.mocked(fetchNewEmails).mockResolvedValue([])
    vi.mocked(prisma.account.update).mockResolvedValue({} as any)

    const results = await syncEmailsForUser('user1')

    expect(results).toHaveLength(2)
    expect(results[0].accountEmail).toBe('user1@example.com')
    expect(results[1].accountEmail).toBe('user2@example.com')
  })

  it('returns error when no categories defined', async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: 'acc1', email: 'test@example.com', userId: 'user1' },
    ] as any)

    vi.mocked(prisma.category.findMany).mockResolvedValue([])

    const results = await syncEmailsForUser('user1')

    expect(results).toHaveLength(1)
    expect(results[0].errors).toContain('No categories defined')
    expect(results[0].processed).toBe(0)
  })

  it('processes new emails successfully', async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: 'acc1', email: 'test@example.com', userId: 'user1' },
    ] as any)

    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { id: 'cat1', name: 'Newsletters', description: 'News' },
    ] as any)

    vi.mocked(prisma.account.findUnique).mockResolvedValue({
      id: 'acc1',
      lastSyncedAt: null,
    } as any)

    vi.mocked(fetchNewEmails).mockResolvedValue([
      {
        gmailId: 'gmail1',
        threadId: 'thread1',
        subject: 'Test Email',
        fromEmail: 'sender@example.com',
        fromName: 'Sender',
        snippet: 'Test snippet',
        body: '<p>Test body</p>',
        receivedAt: new Date(),
        unsubscribeLink: 'https://example.com/unsub',
      },
    ])

    vi.mocked(prisma.email.findUnique).mockResolvedValue(null) // Not a duplicate
    vi.mocked(cleanEmailBody).mockReturnValue('Test body')
    vi.mocked(classifyEmail).mockResolvedValue('cat1')
    vi.mocked(summarizeEmail).mockResolvedValue('Test summary')
    vi.mocked(prisma.email.create).mockResolvedValue({ id: 'email1' } as any)
    vi.mocked(archiveEmail).mockResolvedValue(undefined)
    vi.mocked(prisma.account.update).mockResolvedValue({} as any)

    const results = await syncEmailsForUser('user1')

    expect(results[0].fetched).toBe(1)
    expect(results[0].processed).toBe(1)
    expect(results[0].skipped).toBe(0)
    expect(results[0].errors).toHaveLength(0)

    expect(prisma.email.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        gmailId: 'gmail1',
        categoryId: 'cat1',
        summary: 'Test summary',
        isArchived: true,
      }),
    })

    expect(archiveEmail).toHaveBeenCalledWith('acc1', 'gmail1')
  })

  it('skips duplicate emails', async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: 'acc1', email: 'test@example.com', userId: 'user1' },
    ] as any)

    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { id: 'cat1', name: 'Newsletters', description: 'News' },
    ] as any)

    vi.mocked(prisma.account.findUnique).mockResolvedValue({
      id: 'acc1',
      lastSyncedAt: null,
    } as any)

    vi.mocked(fetchNewEmails).mockResolvedValue([
      {
        gmailId: 'gmail1',
        threadId: 'thread1',
        subject: 'Test Email',
        fromEmail: 'sender@example.com',
        fromName: 'Sender',
        snippet: 'Test snippet',
        body: '<p>Test body</p>',
        receivedAt: new Date(),
        unsubscribeLink: null,
      },
    ])

    // Email already exists
    vi.mocked(prisma.email.findUnique).mockResolvedValue({ id: 'existing' } as any)
    vi.mocked(prisma.account.update).mockResolvedValue({} as any)

    const results = await syncEmailsForUser('user1')

    expect(results[0].fetched).toBe(1)
    expect(results[0].processed).toBe(0)
    expect(results[0].skipped).toBe(1)
    expect(prisma.email.create).not.toHaveBeenCalled()
    expect(classifyEmail).not.toHaveBeenCalled()
  })

  it('handles email processing errors gracefully', async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: 'acc1', email: 'test@example.com', userId: 'user1' },
    ] as any)

    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { id: 'cat1', name: 'Newsletters', description: 'News' },
    ] as any)

    vi.mocked(prisma.account.findUnique).mockResolvedValue({
      id: 'acc1',
      lastSyncedAt: null,
    } as any)

    vi.mocked(fetchNewEmails).mockResolvedValue([
      {
        gmailId: 'gmail1',
        threadId: 'thread1',
        subject: 'Test Email',
        fromEmail: 'sender@example.com',
        fromName: 'Sender',
        snippet: 'Test snippet',
        body: '<p>Test body</p>',
        receivedAt: new Date(),
        unsubscribeLink: null,
      },
    ])

    vi.mocked(prisma.email.findUnique).mockResolvedValue(null)
    vi.mocked(cleanEmailBody).mockReturnValue('Test body')
    vi.mocked(classifyEmail).mockRejectedValue(new Error('AI error'))
    vi.mocked(prisma.account.update).mockResolvedValue({} as any)

    const results = await syncEmailsForUser('user1')

    expect(results[0].processed).toBe(0)
    expect(results[0].errors).toHaveLength(1)
    expect(results[0].errors[0]).toContain('Failed to process email gmail1')
  })

  it('handles fetch errors gracefully', async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: 'acc1', email: 'test@example.com', userId: 'user1' },
    ] as any)

    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { id: 'cat1', name: 'Newsletters', description: 'News' },
    ] as any)

    vi.mocked(prisma.account.findUnique).mockResolvedValue({
      id: 'acc1',
      lastSyncedAt: null,
    } as any)

    vi.mocked(fetchNewEmails).mockRejectedValue(new Error('Gmail API error'))

    const results = await syncEmailsForUser('user1')

    expect(results[0].fetched).toBe(0)
    expect(results[0].processed).toBe(0)
    expect(results[0].errors).toHaveLength(1)
    expect(results[0].errors[0]).toContain('Failed to fetch emails')
  })

  it('handles no accounts', async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([])

    const results = await syncEmailsForUser('user1')

    expect(results).toHaveLength(0)
  })

  it('updates lastSyncedAt after processing', async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: 'acc1', email: 'test@example.com', userId: 'user1' },
    ] as any)

    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { id: 'cat1', name: 'Newsletters', description: 'News' },
    ] as any)

    vi.mocked(prisma.account.findUnique).mockResolvedValue({
      id: 'acc1',
      lastSyncedAt: null,
    } as any)

    vi.mocked(fetchNewEmails).mockResolvedValue([])
    vi.mocked(prisma.account.update).mockResolvedValue({} as any)

    await syncEmailsForUser('user1')

    expect(prisma.account.update).toHaveBeenCalledWith({
      where: { id: 'acc1' },
      data: { lastSyncedAt: expect.any(Date) },
    })
  })

  it('handles emails with no category match', async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: 'acc1', email: 'test@example.com', userId: 'user1' },
    ] as any)

    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { id: 'cat1', name: 'Newsletters', description: 'News' },
    ] as any)

    vi.mocked(prisma.account.findUnique).mockResolvedValue({
      id: 'acc1',
      lastSyncedAt: null,
    } as any)

    vi.mocked(fetchNewEmails).mockResolvedValue([
      {
        gmailId: 'gmail1',
        threadId: 'thread1',
        subject: 'Random Email',
        fromEmail: 'sender@example.com',
        fromName: 'Sender',
        snippet: 'Random snippet',
        body: '<p>Random body</p>',
        receivedAt: new Date(),
        unsubscribeLink: null,
      },
    ])

    vi.mocked(prisma.email.findUnique).mockResolvedValue(null)
    vi.mocked(cleanEmailBody).mockReturnValue('Random body')
    vi.mocked(classifyEmail).mockResolvedValue(null) // No category match
    vi.mocked(summarizeEmail).mockResolvedValue('Random summary')
    vi.mocked(prisma.email.create).mockResolvedValue({ id: 'email1' } as any)
    vi.mocked(archiveEmail).mockResolvedValue(undefined)
    vi.mocked(prisma.account.update).mockResolvedValue({} as any)

    const results = await syncEmailsForUser('user1')

    expect(results[0].processed).toBe(1)
    expect(prisma.email.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        categoryId: null, // Uncategorized
      }),
    })
  })

  it('handles account with unknown email', async () => {
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: 'acc1', email: null, userId: 'user1' }, // No email stored
    ] as any)

    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { id: 'cat1', name: 'Newsletters', description: 'News' },
    ] as any)

    vi.mocked(prisma.account.findUnique).mockResolvedValue({
      id: 'acc1',
      lastSyncedAt: null,
    } as any)

    vi.mocked(fetchNewEmails).mockResolvedValue([])
    vi.mocked(prisma.account.update).mockResolvedValue({} as any)

    const results = await syncEmailsForUser('user1')

    expect(results[0].accountEmail).toBe('Unknown')
  })
})
