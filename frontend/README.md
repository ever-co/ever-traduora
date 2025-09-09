# Traduora Frontend

This is the frontend application for Traduora, an open-source translation management platform. Built with Angular 16 and Bootstrap 4.

## Features

- **Modern UI**: Clean, responsive interface built with Angular and Bootstrap
- **Project Management**: Create, edit, and manage translation projects
- **Translation Editor**: Intuitive interface for managing translations
- **Import/Export**: Support for 20+ file formats
- **Team Management**: Invite and manage team members
- **Real-time Updates**: Live updates using state management
- **Multi-language Support**: Internationalization ready

## Tech Stack

- **Framework**: Angular 16
- **Language**: TypeScript
- **UI Library**: Bootstrap 4 + ng-bootstrap
- **State Management**: NGXS
- **HTTP Client**: Angular HttpClient
- **Build Tool**: Angular CLI
- **Styling**: SCSS

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- Yarn >= 1.13.0

### Installation

1. Install dependencies:
```bash
yarn install
```

2. Configure environment:
```bash
# Edit src/environments/environment.ts
# Set your API base URL
```

3. Start the development server:
```bash
yarn start
```

The application will be available at `http://localhost:4200`

## Environment Configuration

Edit `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api', // Backend API URL
  // Add other environment-specific settings
};
```

## Project Structure

```
src/
├── app/
│   ├── auth/           # Authentication module
│   ├── projects/       # Projects module
│   ├── shared/         # Shared components
│   └── app.module.ts   # Main app module
├── assets/             # Static assets
├── environments/       # Environment configs
└── i18n/              # Internationalization
```

## Key Modules

### Auth Module
- Login/Signup components
- Password reset functionality
- User settings
- JWT token management

### Projects Module
- Project creation and management
- Translation editor
- Import/export functionality
- Team management
- API client management

### Shared Module
- Reusable components
- Directives and pipes
- Guards and interceptors
- Utility functions

## Development

- `yarn start` - Start development server
- `yarn build` - Build for production
- `yarn test` - Run unit tests
- `yarn lint` - Run linter
- `yarn e2e` - Run e2e tests

## Building for Production

```bash
yarn build:prod
```

The built files will be in the `dist/` directory.

## Integration with Backend

The frontend communicates with the backend API through:
- HTTP services in each module
- JWT token authentication
- Error handling interceptors
- State management for data caching

## License

AGPL-3.0-only