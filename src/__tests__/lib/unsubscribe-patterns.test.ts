import { describe, it, expect, vi } from 'vitest'

// Mock playwright to avoid loading the real module
vi.mock('playwright', () => ({
  firefox: {
    launch: vi.fn(),
  },
}))

// Mock openai to avoid loading the real module
vi.mock('@/lib/openai', () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
}))

import { isSuccessPage, isErrorPage } from '@/lib/unsubscribe-agent'

describe('isSuccessPage', () => {
  describe('explicit success messages', () => {
    it('detects "successfully unsubscribed"', () => {
      expect(isSuccessPage('You have been successfully unsubscribed.')).toBe(true)
    })

    it('detects "you are now unsubscribed"', () => {
      expect(isSuccessPage('You are now unsubscribed from our mailing list.')).toBe(true)
    })

    it('detects "already unsubscribed"', () => {
      expect(isSuccessPage('You are already unsubscribed from this list.')).toBe(true)
    })

    it('detects "you\'ve been unsubscribed"', () => {
      expect(isSuccessPage("You've been unsubscribed from all marketing emails.")).toBe(true)
    })

    it('detects "you have been unsubscribed"', () => {
      expect(isSuccessPage('You have been unsubscribed.')).toBe(true)
    })
  })

  describe('preference update messages', () => {
    it('detects "preferences saved"', () => {
      expect(isSuccessPage('Your email preferences have been saved.')).toBe(true)
    })

    it('detects "preferences updated"', () => {
      expect(isSuccessPage('Your preferences have been updated.')).toBe(true)
    })

    it('detects "settings saved"', () => {
      expect(isSuccessPage('Your settings have been saved successfully.')).toBe(true)
    })

    it('detects "changes saved"', () => {
      expect(isSuccessPage('Your changes have been saved.')).toBe(true)
    })
  })

  describe('removal messages', () => {
    it('detects "removed from list"', () => {
      expect(isSuccessPage('You have been removed from our mailing list.')).toBe(true)
    })

    it('detects "we\'ve removed you"', () => {
      expect(isSuccessPage("We've removed you from this list.")).toBe(true)
    })

    it('detects "no longer receive"', () => {
      expect(isSuccessPage('You will no longer receive emails from us.')).toBe(true)
    })
  })

  describe('confirmation messages', () => {
    it('detects "thank you for unsubscribing"', () => {
      expect(isSuccessPage('Thank you for unsubscribing.')).toBe(true)
    })

    it('detects "opt out complete"', () => {
      expect(isSuccessPage('Your opt-out is complete.')).toBe(true)
    })

    it('detects "subscription cancelled"', () => {
      expect(isSuccessPage('Your subscription has been cancelled.')).toBe(true)
    })

    it('detects "unsubscribe successful"', () => {
      expect(isSuccessPage('Unsubscribe successful!')).toBe(true)
    })
  })

  describe('JSON responses', () => {
    it('detects JSON success response', () => {
      expect(isSuccessPage('{"success":true,"message":"unsubscribed"}')).toBe(true)
    })
  })

  describe('false positives (should NOT match)', () => {
    it('rejects regular page content', () => {
      expect(isSuccessPage('Please confirm your email preferences below.')).toBe(false)
    })

    it('rejects unsubscribe buttons/options', () => {
      expect(isSuccessPage('Click here to unsubscribe from all emails.')).toBe(false)
    })

    it('rejects "manage preferences" pages', () => {
      expect(isSuccessPage('Manage your email preferences')).toBe(false)
    })

    it('rejects login pages', () => {
      expect(isSuccessPage('Please log in to manage your subscriptions.')).toBe(false)
    })
  })
})

describe('isErrorPage', () => {
  describe('explicit error messages', () => {
    it('detects "link expired"', () => {
      expect(isErrorPage('This unsubscribe link has expired.')).toBe(true)
    })

    it('detects "invalid link"', () => {
      expect(isErrorPage('Invalid unsubscribe link.')).toBe(true)
    })

    it('detects "error occurred"', () => {
      expect(isErrorPage('An error occurred while processing your request.')).toBe(true)
    })

    it('detects "something went wrong"', () => {
      expect(isErrorPage('Something went wrong. Please try again.')).toBe(true)
    })

    it('detects "try again later"', () => {
      expect(isErrorPage('Service unavailable. Please try again later.')).toBe(true)
    })

    it('detects "unsubscribe failed"', () => {
      expect(isErrorPage('Unsubscribe failed. Please contact support.')).toBe(true)
    })
  })

  describe('false positives (should NOT match)', () => {
    it('rejects success messages', () => {
      expect(isErrorPage('You have been unsubscribed successfully.')).toBe(false)
    })

    it('rejects normal page content', () => {
      expect(isErrorPage('Please select your email preferences.')).toBe(false)
    })

    it('rejects confirmation pages', () => {
      expect(isErrorPage('Confirm your unsubscribe request.')).toBe(false)
    })
  })
})
