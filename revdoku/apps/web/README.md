# Revdoku Web Application (apps/web)

A document inspection and auditing system that uses AI to analyze documents against compliance rules.

## Prerequisites

- Ruby 3.4.5
- SQLite3
- Node.js 20+

## Required Environment Variables

### Development (.env.development or .env.local)

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Rails server port | `3000` |
| `REVDOKU_DOC_API_URL` | AI processing server URL | `http://localhost:4001` |
| `MAILER_SENDER` | Default email sender | `noreply@revdoku.com` |
| `RAILS_CORS_ORIGINS` | Allowed CORS origins | `http://localhost:3000,http://localhost:3036` |

### Production (via credentials or env vars)

| Variable | Description | Required |
|----------|-------------|----------|
| `SMTP_SERVER` | SMTP server (e.g. Amazon SES) | Yes |
| `SMTP_USERNAME` | SMTP login | Yes |
| `SMTP_PASSWORD` | SMTP password | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Optional |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | Optional |

### Rails Credentials (config/credentials.yml.enc)

Edit with: `bin/rails credentials:edit`

```yaml
prefix_id_salt: "your-random-salt-for-uuid-generation"

# Google OAuth (optional)
google:
  client_id: "..."
  client_secret: "..."
```

## Setup

1. Install dependencies:
   ```bash
   bundle install
   npm install
   ```

2. Setup database:
   ```bash
   bin/rails db:create db:migrate db:seed
   ```

3. Start development server:
   ```bash
   bin/dev
   ```

4. Access at http://localhost:3000
   - Default user: `admin@gmail.com` / `1234512345`

## Database

The application uses SQLite3 with performance optimizations (WAL mode, mmap, etc.):

- **Database files**: Stored in `storage/` directory
- **Performance config**: See `config/initializers/sqlite_config.rb`
- **Multi-database**: primary, cache, queue, cable databases

## Email Configuration

### Development
Uses `letter_opener` gem - emails open in your browser automatically instead of being sent.

### Production
Uses SMTP (Amazon SES) for transactional emails. Set `SMTP_SERVER`, `SMTP_USERNAME`, and `SMTP_PASSWORD` environment variables.

## Authentication

- Devise handles user authentication with email confirmation
- Google OAuth available when configured
- Two-factor authentication (TOTP) supported

## Architecture

This is a Rails 8 application with:
- **Frontend**: Vite + React (in `app/frontend/`)
- **Backend**: Rails API + server-rendered views
- **Database**: SQLite3 + Solid Cache/Queue/Cable
- **Admin**: ActiveAdmin dashboard at `/admin`

For more details, see the main project [CLAUDE.md](/CLAUDE.md).
