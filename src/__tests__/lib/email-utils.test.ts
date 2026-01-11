import { describe, it, expect } from 'vitest'
import { cleanEmailBody } from '@/lib/email-utils'

describe('cleanEmailBody', () => {
  it('converts HTML to plain text', () => {
    const html = '<div><p>Hello <strong>World</strong></p></div>'
    const result = cleanEmailBody(html)
    expect(result).toBe('Hello World')
  })

  it('removes excessive whitespace', () => {
    const text = 'Hello    \n\n\n   World'
    const result = cleanEmailBody(text)
    expect(result).toBe('Hello World')
  })

  it('handles empty string', () => {
    expect(cleanEmailBody('')).toBe('')
  })

  it('removes script and style tags', () => {
    const html = '<style>body{color:red}</style><script>alert(1)</script><p>Content</p>'
    const result = cleanEmailBody(html)
    expect(result).not.toContain('body{')
    expect(result).not.toContain('alert')
    expect(result).toContain('Content')
  })

  it('removes image tags', () => {
    const html = '<p>Check this <img src="test.jpg" alt="image">out</p>'
    const result = cleanEmailBody(html)
    expect(result).not.toContain('img')
    expect(result).toContain('Check this')
    expect(result).toContain('out')
  })

  it('removes link hrefs but keeps text', () => {
    const html = '<p>Click <a href="https://example.com">here</a> to continue</p>'
    const result = cleanEmailBody(html)
    expect(result).not.toContain('https://example.com')
    expect(result).toContain('Click')
    expect(result).toContain('here')
    expect(result).toContain('to continue')
  })

  it('handles plain text without HTML', () => {
    const text = 'This is plain text without HTML tags.'
    const result = cleanEmailBody(text)
    expect(result).toBe('This is plain text without HTML tags.')
  })

  it('normalizes multiple newlines', () => {
    const text = 'Line 1\n\n\n\nLine 2'
    const result = cleanEmailBody(text)
    expect(result).toMatch(/Line 1\s+Line 2/)
  })
})
