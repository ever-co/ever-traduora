# Traduora - Translation Management Platform

A complete translation management platform extracted from the original Traduora project, without Docker dependencies.

## Overview

Traduora is an open-source translation management platform that helps teams manage translations for their applications. This extracted version includes the complete frontend and backend code without any Docker functionality.

## Architecture

- **Frontend**: Angular 16 web application
- **Backend**: NestJS API server
- **Database**: PostgreSQL/MySQL/SQLite (configurable)
- **Authentication**: JWT-based authentication

## Quick Start

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
yarn install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your database settings
```

4. Run database migrations:
```bash
yarn typeorm migration:run
```

5. Start the backend server:
```bash
yarn start
```

The API will be available at `http://localhost:3000`

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
yarn install
```

3. Configure the API URL in `src/environments/environment.ts`:
```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
};
```

4. Start the frontend development server:
```bash
yarn start
```

The application will be available at `http://localhost:4200`

## Features

### Core Features
- **Project Management**: Create and manage translation projects
- **Multi-format Support**: Import/export in 20+ formats (JSON, XLIFF, PO, CSV, etc.)
- **Team Collaboration**: Invite team members with different roles
- **API Access**: Generate API keys for programmatic access
- **Labels & Context**: Organize translations with labels and context
- **Statistics**: Track translation progress and completion rates

### Supported Formats
- JSON (flat and nested)
- XLIFF 1.2 and 2.0
- Gettext PO files
- Android XML
- iOS Strings
- .NET RESX
- CSV
- Properties files
- YAML (flat and nested)
- PHP arrays

## Technology Stack

### Backend
- **Framework**: NestJS
- **Language**: TypeScript
- **Database**: TypeORM with PostgreSQL/MySQL/SQLite support
- **Authentication**: JWT + Passport
- **Validation**: Class Validator
- **Documentation**: Swagger/OpenAPI
- **Testing**: Jest

### Frontend
- **Framework**: Angular 16
- **Language**: TypeScript
- **UI Library**: Bootstrap 4 + ng-bootstrap
- **State Management**: NGXS
- **Styling**: SCSS
- **Build Tool**: Angular CLI

## Development

### Backend Development
```bash
cd backend
yarn start          # Start development server
yarn build          # Build for production
yarn test           # Run unit tests
yarn test:e2e       # Run e2e tests
yarn lint           # Run linter
yarn fmt            # Format code
```

### Frontend Development
```bash
cd frontend
yarn start          # Start development server
yarn build          # Build for production
yarn build:prod     # Build for production (optimized)
yarn test           # Run unit tests
yarn lint           # Run linter
yarn e2e            # Run e2e tests
```

## Configuration

### Backend Environment Variables
- `TR_DB_TYPE`: Database type (postgres, mysql, sqlite)
- `TR_DB_HOST`: Database host
- `TR_DB_PORT`: Database port
- `TR_DB_USERNAME`: Database username
- `TR_DB_PASSWORD`: Database password
- `TR_DB_DATABASE`: Database name
- `TR_JWT_SECRET`: JWT secret key
- `TR_MAIL_HOST`: SMTP host for emails
- `TR_CORS_ENABLED`: Enable CORS (true/false)

### Frontend Environment
Edit `frontend/src/environments/environment.ts` to configure:
- API base URL
- Production settings
- Feature flags

## API Documentation

Once the backend is running, visit `http://localhost:3000/api` for interactive Swagger documentation.

## Database Setup

The application supports multiple databases:

### PostgreSQL
```bash
# Install PostgreSQL and create database
createdb traduora
```

### MySQL
```bash
# Install MySQL and create database
mysql -u root -p
CREATE DATABASE traduora;
```

### SQLite
```bash
# SQLite will create the database file automatically
# No additional setup required
```

## Deployment

### Backend Deployment
1. Build the application: `yarn build`
2. Set production environment variables
3. Run database migrations: `yarn typeorm migration:run`
4. Start the application: `node dist/main.js`

### Frontend Deployment
1. Build the application: `yarn build:prod`
2. Serve the `dist/` directory with any web server
3. Configure the API URL for production

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the AGPL-3.0-only License - see the [LICENSE](LICENSE) file for details.

## Support

For support and questions:
- Check the documentation in the `docs/` directory
- Review the API documentation at `/api` when running
- Open an issue on the repository

## Acknowledgments

This project is based on the original Traduora project by Ever Co. LTD.