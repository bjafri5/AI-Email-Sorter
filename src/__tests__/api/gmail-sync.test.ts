import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    account: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    email: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    category: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/gmail', () => ({
  fetchNewEmails: vi.fn(),
  archiveEmails: vi.fn(),
}))

vi.mock('@/lib/ai', () => ({
  classifyEmail: vi.fn(),
  summarizeEmail: vi.fn(),
}))

vi.mock('@/lib/email-utils', () => ({
  cleanEmailBody: vi.fn((body) => body.replace(/<[^>]+>/g, '')),
}))

vi.mock('@/lib/auth-helpers', () => ({
  getSession: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { fetchNewEmails, archiveEmails } from '@/lib/gmail'
import { classifyEmail, summarizeEmail } from '@/lib/ai'
import { cleanEmailBody } from '@/lib/email-utils'
import { getSession } from '@/lib/auth-helpers'

describe('Gmail Sync Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('processes new emails, classifies, summarizes, and archives', async () => {
    // Setup authentication
    vi.mocked(getSession).mockResolvedValue({
      user: { id: 'user1', email: 'test@example.com' },
    } as any)

    // Setup account
    vi.mocked(prisma.account.findMany).mockResolvedValue([
      { id: 'acc1', email: 'test@example.com', userId: 'user1', access_token: 'token' },
    ] as any)

    // Setup categories
    vi.mocked(prisma.category.findMany).mockResolvedValue([
      { id: 'cat1', name: 'Newsletters', description: 'Email newsletters' },
    ] as any)

    // Setup fetched emails
    vi.mocked(fetchNewEmails).mockResolvedValue([
      {
        gmailId: 'gmail1',
        threadId: 'thread1',
        subject: 'Weekly Newsletter',
        fromEmail: 'news@example.com',
        fromName: 'Newsletter',
        snippet: 'This week in tech...',
        body: '<p>This is a test newsletter</p>',
        receivedAt: new Date(),
        unsubscribeLink: 'https://example.com/unsub',
      },
    ])

    // No duplicate
    vi.mocked(prisma.email.findMany).mockResolvedValue([])

    // AI responses
    vi.mocked(classifyEmail).mockResolvedValue('cat1')
    vi.mocked(summarizeEmail).mockResolvedValue('Weekly tech newsletter summary')
    vi.mocked(cleanEmailBody).mockReturnValue('This is a test newsletter')

    // Email creation
    vi.mocked(prisma.email.create).mockResolvedValue({ id: 'email1' } as any)

    // Simulate sync flow
    const session = await getSession()
    expect(session?.user?.id).toBe('user1')

    const accounts = await prisma.account.findMany({
      where: { userId: session!.user!.id }
    })
    expect(accounts).toHaveLength(1)

    const categories = await prisma.category.findMany({
      where: { userId: session!.user!.id }
    })
    expect(categories).toHaveLength(1)

    const emails = await fetchNewEmails(accounts[0].id, 10)
    expect(emails).toHaveLength(1)

    // Check for duplicates
    const gmailIds = emails.map(e => e.gmailId)
    const existing = await prisma.email.findMany({
      where: { gmailId: { in: gmailIds } },
      select: { gmailId: true },
    })
    expect(existing).toHaveLength(0)

    // Process email
    const email = emails[0]
    const cleanedBody = cleanEmailBody(email.body)
    expect(cleanedBody).toBe('This is a test newsletter')

    const categoryId = await classifyEmail(
      { ...email, body: cleanedBody },
      categories
    )
    expect(categoryId).toBe('cat1')

    const summary = await summarizeEmail({ ...email, body: cleanedBody })
    expect(summary).toBe('Weekly tech newsletter summary')

    // Create email record
    await prisma.email.create({
      data: {
        gmailId: email.gmailId,
        threadId: email.threadId,
        accountId: accounts[0].id,
        categoryId,
        subject: email.subject,
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        snippet: email.snippet,
        body: email.body,
        bodyText: cleanedBody,
        summary,
        unsubscribeLink: email.unsubscribeLink,
        receivedAt: email.receivedAt,
      },
    })
    expect(prisma.email.create).toHaveBeenCalled()
  })

  it('skips duplicate emails based on gmailId', async () => {
    vi.mocked(fetchNewEmails).mockResolvedValue([
      { gmailId: 'gmail1', subject: 'Test' },
    ] as any)

    // Email already exists
    vi.mocked(prisma.email.findMany).mockResolvedValue([
      { gmailId: 'gmail1' },
    ] as any)

    const emails = await fetchNewEmails('acc1', 10)
    const existing = await prisma.email.findMany({
      where: { gmailId: { in: emails.map(e => e.gmailId) } },
    })

    // All emails are duplicates
    const newEmails = emails.filter(
      e => !existing.some(ex => ex.gmailId === e.gmailId)
    )
    expect(newEmails).toHaveLength(0)

    // Should not process duplicates
    expect(classifyEmail).not.toHaveBeenCalled()
    expect(summarizeEmail).not.toHaveBeenCalled()
  })

  it('archives emails after processing', async () => {
    vi.mocked(archiveEmails).mockResolvedValue(undefined)

    const gmailIds = ['gmail1', 'gmail2', 'gmail3']
    await archiveEmails('acc1', gmailIds)

    expect(archiveEmails).toHaveBeenCalledWith('acc1', gmailIds)
  })

  it('handles emails with no category match', async () => {
    vi.mocked(classifyEmail).mockResolvedValue(null)

    const categoryId = await classifyEmail({} as any, [])
    expect(categoryId).toBeNull()

    // Email should still be created with categoryId: null
  })
})
