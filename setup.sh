#!/bin/bash

# Traduora Setup Script
# This script helps set up the Traduora translation management platform

echo "🚀 Setting up Traduora Translation Management Platform"
echo "=================================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js >= 18.0.0"
    exit 1
fi

# Check if Yarn is installed
if ! command -v yarn &> /dev/null; then
    echo "❌ Yarn is not installed. Please install Yarn >= 1.13.0"
    exit 1
fi

echo "✅ Node.js and Yarn are installed"

# Setup Backend
echo ""
echo "📦 Setting up Backend..."
cd backend

# Install dependencies
echo "Installing backend dependencies..."
yarn install

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cat > .env << EOL
# Database Configuration
TR_DB_TYPE=sqlite
TR_DB_DATABASE=traduora.db

# JWT Configuration
TR_JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# CORS Configuration
TR_CORS_ENABLED=true

# Mail Configuration (optional)
TR_MAIL_DEBUG=true
TR_MAIL_HOST=
TR_MAIL_PORT=587
TR_MAIL_USER=
TR_MAIL_PASS=

# Other Configuration
TR_ACCESS_LOGS_ENABLED=true
TR_DEFAULT_PROJECT_PLAN=default
EOL
    echo "✅ Created .env file with default SQLite configuration"
else
    echo "✅ .env file already exists"
fi

# Run database migrations
echo "Running database migrations..."
yarn typeorm migration:run

# Seed database
echo "Seeding database with initial data..."
yarn seed:default

echo "✅ Backend setup complete!"
cd ..

# Setup Frontend
echo ""
echo "📦 Setting up Frontend..."
cd frontend

# Install dependencies
echo "Installing frontend dependencies..."
yarn install

# Create environment file if it doesn't exist
if [ ! -f src/environments/environment.ts ]; then
    echo "Creating environment configuration..."
    cat > src/environments/environment.ts << EOL
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api'
};
EOL
    echo "✅ Created environment configuration"
else
    echo "✅ Environment configuration already exists"
fi

echo "✅ Frontend setup complete!"
cd ..

echo ""
echo "🎉 Setup complete!"
echo ""
echo "To start the application:"
echo "1. Start the backend: cd backend && yarn start"
echo "2. Start the frontend: cd frontend && yarn start"
echo ""
echo "The application will be available at:"
echo "- Frontend: http://localhost:4200"
echo "- Backend API: http://localhost:3000"
echo "- API Documentation: http://localhost:3000/api"
echo ""
echo "Default admin credentials:"
echo "- Email: admin@traduora.co"
echo "- Password: admin"
