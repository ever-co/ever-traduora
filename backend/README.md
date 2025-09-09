# Traduora Backend API

This is the backend API for Traduora, an open-source translation management platform. Built with NestJS, TypeScript, and TypeORM.

## Features

- **Authentication & Authorization**: JWT-based auth with role-based access control
- **Project Management**: Create and manage translation projects
- **Multi-format Support**: Import/export in 20+ formats (JSON, XLIFF, PO, CSV, etc.)
- **Team Collaboration**: Invite team members with different roles
- **API Clients**: Generate API keys for programmatic access
- **Labels & Context**: Organize translations with labels and context
- **Statistics**: Track translation progress and completion rates

## Tech Stack

- **Framework**: NestJS
- **Language**: TypeScript
- **Database**: PostgreSQL/MySQL/SQLite (TypeORM)
- **Authentication**: JWT + Passport
- **Validation**: Class Validator
- **Documentation**: Swagger/OpenAPI
- **Testing**: Jest

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- Yarn >= 1.13.0
- PostgreSQL/MySQL/SQLite database

### Installation

1. Install dependencies:
```bash
yarn install
```

2. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your database and other settings
```

3. Run database migrations:
```bash
yarn typeorm migration:run
```

4. Seed the database (optional):
```bash
yarn seed
```

5. Start the development server:
```bash
yarn start
```

The API will be available at `http://localhost:3000`

## Environment Variables

Key environment variables to configure:

- `TR_DB_TYPE`: Database type (postgres, mysql, sqlite)
- `TR_DB_HOST`: Database host
- `TR_DB_PORT`: Database port
- `TR_DB_USERNAME`: Database username
- `TR_DB_PASSWORD`: Database password
- `TR_DB_DATABASE`: Database name
- `TR_JWT_SECRET`: JWT secret key
- `TR_MAIL_HOST`: SMTP host for emails
- `TR_MAIL_PORT`: SMTP port
- `TR_MAIL_USER`: SMTP username
- `TR_MAIL_PASS`: SMTP password

## API Documentation

Once running, visit `http://localhost:3000/api` for Swagger documentation.

## Project Structure

```
src/
├── controllers/     # API endpoints
├── services/        # Business logic
├── entity/          # Database entities
├── formatters/      # Import/export formatters
├── guards/          # Authentication guards
├── middlewares/     # Custom middlewares
├── migrations/      # Database migrations
├── seeds/           # Database seeders
└── utils/           # Utility functions
```

## Development

- `yarn start` - Start development server
- `yarn build` - Build for production
- `yarn test` - Run unit tests
- `yarn test:e2e` - Run e2e tests
- `yarn lint` - Run linter
- `yarn fmt` - Format code

## License

AGPL-3.0-only