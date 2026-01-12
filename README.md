# AI Email Sorter

An AI-powered email management app that automatically categorizes Gmail emails, generates summaries, and automates unsubscribes.

## Features

- **AI Classification**: Automatically sorts emails into user-defined categories
- **Smart Summaries**: AI-generated 1-2 sentence summaries for quick scanning
- **Bulk Unsubscribe**: Automated unsubscribe using Playwright + AI agent
- **Real-time Sync**: SSE-powered progress updates during sync and operations

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables (e.g. copy from .env.example)
cp .env.example .env

# Push database schema
npx prisma db push

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with Google.

## Environment Variables

Required in `.env`:

```
DATABASE_URL=postgresql://...
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<random-secret>
GOOGLE_CLIENT_ID=<oauth-client-id>
GOOGLE_CLIENT_SECRET=<oauth-client-secret>
OPENAI_API_KEY=<api-key>
```

## Commands

```bash
npm run dev      # Start dev server
npm run build    # Build for production
npm run test     # Run tests (Vitest)
npm run lint     # Run ESLint
```

## Tech Stack

- Next.js 16 (App Router)
- NextAuth.js + Google OAuth
- PostgreSQL + Prisma
- OpenAI (gpt-5-nano/mini)
- Playwright (Chromium) for unsubscribe automation
- Tailwind CSS + Radix UI
