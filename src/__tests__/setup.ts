import { beforeAll, afterEach, vi } from 'vitest'

// Global test setup
beforeAll(() => {
  // Set test environment variables
  process.env.OPENAI_API_KEY = 'test-key'
  process.env.DATABASE_URL = 'postgresql://test'
  process.env.GOOGLE_CLIENT_ID = 'test-client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
})

afterEach(() => {
  // Reset all mocks between tests
  vi.clearAllMocks()
})
