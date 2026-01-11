import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock OpenAI
vi.mock('@/lib/openai', () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
}))

import { openai } from '@/lib/openai'
import { classifyEmail, summarizeEmail, extractUnsubscribeLinkAI } from '@/lib/ai'

const mockCategories = [
  { id: 'cat1', name: 'Newsletters', description: 'Email newsletters and digests' },
  { id: 'cat2', name: 'Promotions', description: 'Marketing and promotional emails' },
  { id: 'cat3', name: 'Services', description: 'Service notifications and alerts' },
]

const mockEmail = {
  subject: 'Weekly Tech Digest',
  fromEmail: 'newsletter@example.com',
  fromName: 'Tech News',
  body: 'Here are this week\'s top stories in tech...',
  snippet: 'Top stories...',
}

describe('classifyEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns correct category ID when AI returns valid number', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: '1' } }],
    } as any)

    const result = await classifyEmail(mockEmail, mockCategories)
    expect(result).toBe('cat1')
  })

  it('returns second category when AI returns 2', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: '2' } }],
    } as any)

    const result = await classifyEmail(mockEmail, mockCategories)
    expect(result).toBe('cat2')
  })

  it('returns null when AI returns 0 (no match)', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: '0' } }],
    } as any)

    const result = await classifyEmail(mockEmail, mockCategories)
    expect(result).toBeNull()
  })

  it('returns null when AI returns invalid text', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: 'invalid response' } }],
    } as any)

    const result = await classifyEmail(mockEmail, mockCategories)
    expect(result).toBeNull()
  })

  it('returns null when AI returns number out of range', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: '10' } }],
    } as any)

    const result = await classifyEmail(mockEmail, mockCategories)
    expect(result).toBeNull()
  })

  it('returns null when categories array is empty', async () => {
    const result = await classifyEmail(mockEmail, [])
    expect(result).toBeNull()
    expect(openai.chat.completions.create).not.toHaveBeenCalled()
  })

  it('returns null on API error', async () => {
    vi.mocked(openai.chat.completions.create).mockRejectedValue(new Error('API error'))

    const result = await classifyEmail(mockEmail, mockCategories)
    expect(result).toBeNull()
  })

  it('truncates long email body in prompt', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: '1' } }],
    } as any)

    const longBodyEmail = { ...mockEmail, body: 'x'.repeat(10000) }
    await classifyEmail(longBodyEmail, mockCategories)

    const call = vi.mocked(openai.chat.completions.create).mock.calls[0]
    const prompt = (call[0] as any).messages[0].content
    // Body should be truncated to 5000 chars
    expect(prompt.length).toBeLessThan(10000)
  })

  it('uses fromEmail when fromName is null', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: '1' } }],
    } as any)

    const emailNoName = { ...mockEmail, fromName: null }
    await classifyEmail(emailNoName, mockCategories)

    const call = vi.mocked(openai.chat.completions.create).mock.calls[0]
    const prompt = (call[0] as any).messages[0].content
    expect(prompt).toContain(`From: ${mockEmail.fromEmail}`)
  })

  it('handles malformed API response with missing choices', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [],
    } as any)

    const result = await classifyEmail(mockEmail, mockCategories)
    expect(result).toBeNull()
  })

  it('handles malformed API response with null message content', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: null } }],
    } as any)

    const result = await classifyEmail(mockEmail, mockCategories)
    expect(result).toBeNull()
  })
})

describe('summarizeEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns AI-generated summary', async () => {
    const mockSummary = 'Weekly tech newsletter with top stories.'
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: mockSummary } }],
    } as any)

    const result = await summarizeEmail(mockEmail)
    expect(result).toBe(mockSummary)
  })

  it('returns snippet as fallback when AI returns empty', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: '' } }],
    } as any)

    const result = await summarizeEmail(mockEmail)
    expect(result).toBe(mockEmail.snippet)
  })

  it('returns subject as fallback when no snippet and AI fails', async () => {
    vi.mocked(openai.chat.completions.create).mockRejectedValue(new Error('API error'))

    const emailNoSnippet = { ...mockEmail, snippet: null }
    const result = await summarizeEmail(emailNoSnippet)
    expect(result).toBe(mockEmail.subject)
  })

  it('returns snippet on API error', async () => {
    vi.mocked(openai.chat.completions.create).mockRejectedValue(new Error('API error'))

    const result = await summarizeEmail(mockEmail)
    expect(result).toBe(mockEmail.snippet)
  })

  it('uses fromEmail when fromName is null', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: 'Summary text' } }],
    } as any)

    const emailNoName = { ...mockEmail, fromName: null }
    await summarizeEmail(emailNoName)

    const call = vi.mocked(openai.chat.completions.create).mock.calls[0]
    const prompt = (call[0] as any).messages[0].content
    expect(prompt).toContain(`From: ${mockEmail.fromEmail}`)
  })

  it('handles malformed API response with missing choices', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [],
    } as any)

    const result = await summarizeEmail(mockEmail)
    // Falls back to snippet when content is undefined
    expect(result).toBe(mockEmail.snippet)
  })

  it('handles malformed API response with null message content', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: null } }],
    } as any)

    const result = await summarizeEmail(mockEmail)
    expect(result).toBe(mockEmail.snippet)
  })

  it('returns subject when both AI fails and snippet is null', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: '' } }],
    } as any)

    const emailNoSnippet = { ...mockEmail, snippet: null }
    const result = await summarizeEmail(emailNoSnippet)
    expect(result).toBe(mockEmail.subject)
  })
})

describe('extractUnsubscribeLinkAI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns URL when AI finds valid link', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: 'https://example.com/unsubscribe' } }],
    } as any)

    const result = await extractUnsubscribeLinkAI('<p>Email content...</p>')
    expect(result).toBe('https://example.com/unsubscribe')
  })

  it('returns null when AI returns NONE', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: 'NONE' } }],
    } as any)

    const result = await extractUnsubscribeLinkAI('<p>Email content...</p>')
    expect(result).toBeNull()
  })

  it('returns null when AI returns non-URL text', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: 'No unsubscribe link found' } }],
    } as any)

    const result = await extractUnsubscribeLinkAI('<p>Email content...</p>')
    expect(result).toBeNull()
  })

  it('returns null on API error', async () => {
    vi.mocked(openai.chat.completions.create).mockRejectedValue(new Error('API error'))

    const result = await extractUnsubscribeLinkAI('<p>Email content...</p>')
    expect(result).toBeNull()
  })

  it('uses last 10000 chars of email body', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: 'NONE' } }],
    } as any)

    const longBody = 'x'.repeat(15000) + '<a href="https://example.com/unsub">Unsubscribe</a>'
    await extractUnsubscribeLinkAI(longBody)

    const call = vi.mocked(openai.chat.completions.create).mock.calls[0]
    const prompt = (call[0] as any).messages[0].content
    // Should contain the unsubscribe link from the end
    expect(prompt).toContain('unsub')
  })

  it('handles malformed API response with missing choices', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [],
    } as any)

    const result = await extractUnsubscribeLinkAI('<p>Email content...</p>')
    expect(result).toBeNull()
  })

  it('handles malformed API response with null message content', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: null } }],
    } as any)

    const result = await extractUnsubscribeLinkAI('<p>Email content...</p>')
    expect(result).toBeNull()
  })

  it('handles short email body without truncation', async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: 'https://example.com/unsub' } }],
    } as any)

    const shortBody = '<p>Short email</p>'
    const result = await extractUnsubscribeLinkAI(shortBody)
    expect(result).toBe('https://example.com/unsub')
  })
})
