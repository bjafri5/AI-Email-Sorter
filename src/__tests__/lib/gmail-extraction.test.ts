import { describe, it, expect } from 'vitest'

import { extractUnsubscribeLinkFast, extractEmail, extractName, decodeHtmlEntities } from '@/lib/gmail'

describe('extractUnsubscribeLinkFast', () => {
  describe('anchor tag extraction', () => {
    it('extracts link from anchor tag with "unsubscribe" text', () => {
      const body = '<p>Not interested? <a href="https://example.com/unsub">Unsubscribe here</a></p>'
      const result = extractUnsubscribeLinkFast('', body)
      expect(result).toBe('https://example.com/unsub')
    })

    it('extracts link when "unsubscribe" precedes anchor', () => {
      const body = '<p>To unsubscribe, <a href="https://example.com/unsub">click here</a></p>'
      const result = extractUnsubscribeLinkFast('', body)
      expect(result).toBe('https://example.com/unsub')
    })

    it('extracts link when "unsubscribe" follows anchor', () => {
      const body = '<p><a href="https://example.com/unsub">Click here</a> to unsubscribe</p>'
      const result = extractUnsubscribeLinkFast('', body)
      expect(result).toBe('https://example.com/unsub')
    })

    it('handles case-insensitive matching', () => {
      const body = '<a href="https://example.com/unsub">UNSUBSCRIBE</a>'
      const result = extractUnsubscribeLinkFast('', body)
      expect(result).toBe('https://example.com/unsub')
    })

    it('skips mailto: links in body and returns null', () => {
      const body = '<a href="mailto:unsub@example.com">Unsubscribe</a>'
      const result = extractUnsubscribeLinkFast('', body)
      // Returns null since no http link found (no AI fallback in fast version)
      expect(result).toBeNull()
    })

    it('decodes HTML entities in URLs', () => {
      const body = '<a href="https://example.com/unsub?a=1&amp;b=2">Unsubscribe</a>'
      const result = extractUnsubscribeLinkFast('', body)
      expect(result).toBe('https://example.com/unsub?a=1&b=2')
    })
  })

  describe('opt-out pattern extraction', () => {
    it('extracts opt-out links', () => {
      const body = '<p><a href="https://example.com/optout">Opt out of emails</a></p>'
      const result = extractUnsubscribeLinkFast('', body)
      expect(result).toBe('https://example.com/optout')
    })

    it('extracts opt-out with hyphen', () => {
      const body = '<a href="https://example.com/optout">Opt-out here</a>'
      const result = extractUnsubscribeLinkFast('', body)
      expect(result).toBe('https://example.com/optout')
    })

    it('extracts optout without space', () => {
      const body = '<a href="https://example.com/optout">Optout of all</a>'
      const result = extractUnsubscribeLinkFast('', body)
      expect(result).toBe('https://example.com/optout')
    })
  })

  describe('List-Unsubscribe header extraction', () => {
    it('extracts https URL from header', () => {
      const header = '<https://example.com/unsubscribe>, <mailto:unsub@example.com>'
      const result = extractUnsubscribeLinkFast(header, '<p>No unsub link in body</p>')
      expect(result).toBe('https://example.com/unsubscribe')
    })

    it('extracts http URL from header', () => {
      const header = '<http://example.com/unsubscribe>'
      const result = extractUnsubscribeLinkFast(header, '<p>No unsub link in body</p>')
      expect(result).toBe('http://example.com/unsubscribe')
    })

    it('returns null for mailto-only header', () => {
      const header = '<mailto:unsub@example.com>'
      const result = extractUnsubscribeLinkFast(header, '<p>No unsub link in body</p>')
      // Returns null (no AI fallback in fast version)
      expect(result).toBeNull()
    })

    it('prefers body link over header', () => {
      const header = '<https://header.com/unsubscribe>'
      const body = '<a href="https://body.com/unsub">Unsubscribe</a>'
      const result = extractUnsubscribeLinkFast(header, body)
      // Body takes precedence over header
      expect(result).toBe('https://body.com/unsub')
    })
  })

  describe('edge cases', () => {
    it('handles empty body and header', () => {
      const result = extractUnsubscribeLinkFast('', '')
      expect(result).toBeNull()
    })

    it('handles body with no anchor tags', () => {
      const body = '<p>This is a plain text email with no links.</p>'
      const result = extractUnsubscribeLinkFast('', body)
      expect(result).toBeNull()
    })

    it('handles multiple unsubscribe links (returns first)', () => {
      const body = `
        <a href="https://first.com/unsub">Unsubscribe</a>
        <a href="https://second.com/unsub">Unsubscribe from all</a>
      `
      const result = extractUnsubscribeLinkFast('', body)
      expect(result).toBe('https://first.com/unsub')
    })
  })
})

describe('extractEmail', () => {
  it('extracts email from "Name <email>" format', () => {
    expect(extractEmail('John Doe <john@example.com>')).toBe('john@example.com')
  })

  it('extracts email from quoted name format', () => {
    expect(extractEmail('"John Doe" <john@example.com>')).toBe('john@example.com')
  })

  it('returns original string when no angle brackets', () => {
    expect(extractEmail('john@example.com')).toBe('john@example.com')
  })

  it('handles empty string', () => {
    expect(extractEmail('')).toBe('')
  })

  it('handles name with special characters', () => {
    expect(extractEmail('John "The Man" Doe <john@example.com>')).toBe('john@example.com')
  })

  it('handles email-only without name', () => {
    expect(extractEmail('<john@example.com>')).toBe('john@example.com')
  })
})

describe('extractName', () => {
  it('extracts name from "Name <email>" format', () => {
    expect(extractName('John Doe <john@example.com>')).toBe('John Doe')
  })

  it('extracts name and removes quotes', () => {
    expect(extractName('"John Doe" <john@example.com>')).toBe('John Doe')
  })

  it('returns empty string when no name before angle bracket', () => {
    expect(extractName('<john@example.com>')).toBe('')
  })

  it('returns empty string for email-only format', () => {
    expect(extractName('john@example.com')).toBe('')
  })

  it('handles empty string', () => {
    expect(extractName('')).toBe('')
  })

  it('trims whitespace from name', () => {
    expect(extractName('  John Doe  <john@example.com>')).toBe('John Doe')
  })

  it('handles name with multiple spaces', () => {
    expect(extractName('John  Doe <john@example.com>')).toBe('John  Doe')
  })
})

describe('decodeHtmlEntities', () => {
  it('decodes &amp; to &', () => {
    expect(decodeHtmlEntities('a=1&amp;b=2')).toBe('a=1&b=2')
  })

  it('decodes &lt; to <', () => {
    expect(decodeHtmlEntities('&lt;div&gt;')).toBe('<div>')
  })

  it('decodes &gt; to >', () => {
    expect(decodeHtmlEntities('a &gt; b')).toBe('a > b')
  })

  it('decodes &quot; to double quote', () => {
    expect(decodeHtmlEntities('&quot;hello&quot;')).toBe('"hello"')
  })

  it('decodes &#39; to single quote', () => {
    expect(decodeHtmlEntities('it&#39;s')).toBe("it's")
  })

  it('decodes multiple entities in one string', () => {
    expect(decodeHtmlEntities('a=1&amp;b=2&amp;c=&lt;3&gt;')).toBe('a=1&b=2&c=<3>')
  })

  it('returns original string if no entities', () => {
    expect(decodeHtmlEntities('hello world')).toBe('hello world')
  })

  it('handles empty string', () => {
    expect(decodeHtmlEntities('')).toBe('')
  })
})
