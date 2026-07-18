# Triviality CRM

AI-assisted North American lead research and sales CRM for Triviality.

## Foundation included

- Responsive dashboard and navigation
- AI lead-search workspace with location, lead type and score controls
- PostgreSQL/Prisma data model for companies, multiple contacts, editable pipeline stages, lead types, competitors, users, roles and permissions
- Saved prompts, saved searches, ranked results, dispositions and source evidence
- Duplicate-matching fields and mutually exclusive trivia classification
- Sales activities and assigned follow-up tasks
- Rejection reasons and rejected-result history
- Spreadsheet mapping template storage
- Environment template with no committed credentials

## Installation

1. Install Node.js 20+ and PostgreSQL 16+.
2. Copy `.env.example` to `.env` and supply real values.
3. Run `npm install`.
4. Run `npx prisma generate`.
5. Run `npx prisma migrate dev --name initial`.
6. Run `npm run dev` for local use or `npm run build && npm start` for production.

## Service adapters still requiring credentials

The live AI prompt interview, business web research and email delivery must be connected during installation. Keep provider credentials only in environment variables; never commit them.

## Core data rules

- A company has one lead type, one pipeline stage, one assigned salesperson and zero or one competitor.
- Competitor location totals are calculated from linked companies.
- Contacts are separate records, allowing multiple contacts per company.
- Uncertain trivia status is excluded from both Current Trivia and No Current Trivia result lists.
- Duplicate candidates are blocked before transfer or import.
