import { describe, it, expect } from 'vitest'
import { friendlyUnsubscribeErrorMessage } from '@/lib/error-messages'

describe('friendlyUnsubscribeErrorMessage', () => {
  it('converts timeout errors', () => {
    expect(friendlyUnsubscribeErrorMessage('Timeout 20000ms exceeded'))
      .toBe('Page took too long to load. Please try again.')
    expect(friendlyUnsubscribeErrorMessage('timeout waiting for element'))
      .toBe('Page took too long to load. Please try again.')
  })

  it('converts "no interactive elements" errors', () => {
    expect(friendlyUnsubscribeErrorMessage('No interactive elements found'))
      .toBe('Could not find unsubscribe button. Please try again.')
  })

  it('converts navigation/network errors', () => {
    expect(friendlyUnsubscribeErrorMessage('Navigation failed'))
      .toBe('Could not reach the unsubscribe page. Please try again.')
    expect(friendlyUnsubscribeErrorMessage('net::ERR_CONNECTION_REFUSED'))
      .toBe('Could not reach the unsubscribe page. Please try again.')
  })

  it('converts AI response errors', () => {
    expect(friendlyUnsubscribeErrorMessage('AI response parsing failed'))
      .toBe('Something went wrong. Please try again.')
  })

  it('truncates long technical messages', () => {
    const longError = 'Error: ' + 'a'.repeat(150)
    expect(friendlyUnsubscribeErrorMessage(longError))
      .toBe('Unsubscribe failed. Please try again.')
  })

  it('passes through short user-friendly messages', () => {
    expect(friendlyUnsubscribeErrorMessage('Custom error'))
      .toBe('Custom error')
    expect(friendlyUnsubscribeErrorMessage('Link expired'))
      .toBe('Link expired')
  })
})
