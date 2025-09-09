@echo off
REM Traduora Setup Script for Windows
REM This script helps set up the Traduora translation management platform

echo 🚀 Setting up Traduora Translation Management Platform
echo ==================================================

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js ^>= 18.0.0
    exit /b 1
)

REM Check if Yarn is installed
yarn --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Yarn is not installed. Please install Yarn ^>= 1.13.0
    exit /b 1
)

echo ✅ Node.js and Yarn are installed

REM Setup Backend
echo.
echo 📦 Setting up Backend...
cd backend

REM Install dependencies
echo Installing backend dependencies...
yarn install

REM Create .env file if it doesn't exist
if not exist .env (
    echo Creating .env file...
    (
        echo # Database Configuration
        echo TR_DB_TYPE=sqlite
        echo TR_DB_DATABASE=traduora.db
        echo.
        echo # JWT Configuration
        echo TR_JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
        echo.
        echo # CORS Configuration
        echo TR_CORS_ENABLED=true
        echo.
        echo # Mail Configuration ^(optional^)
        echo TR_MAIL_DEBUG=true
        echo TR_MAIL_HOST=
        echo TR_MAIL_PORT=587
        echo TR_MAIL_USER=
        echo TR_MAIL_PASS=
        echo.
        echo # Other Configuration
        echo TR_ACCESS_LOGS_ENABLED=true
        echo TR_DEFAULT_PROJECT_PLAN=default
    ) > .env
    echo ✅ Created .env file with default SQLite configuration
) else (
    echo ✅ .env file already exists
)

REM Run database migrations
echo Running database migrations...
yarn typeorm migration:run

REM Seed database
echo Seeding database with initial data...
yarn seed:default

echo ✅ Backend setup complete!
cd ..

REM Setup Frontend
echo.
echo 📦 Setting up Frontend...
cd frontend

REM Install dependencies
echo Installing frontend dependencies...
yarn install

REM Create environment file if it doesn't exist
if not exist src\environments\environment.ts (
    echo Creating environment configuration...
    (
        echo export const environment = {
        echo   production: false,
        echo   apiUrl: 'http://localhost:3000/api'
        echo };
    ) > src\environments\environment.ts
    echo ✅ Created environment configuration
) else (
    echo ✅ Environment configuration already exists
)

echo ✅ Frontend setup complete!
cd ..

echo.
echo 🎉 Setup complete!
echo.
echo To start the application:
echo 1. Start the backend: cd backend ^&^& yarn start
echo 2. Start the frontend: cd frontend ^&^& yarn start
echo.
echo The application will be available at:
echo - Frontend: http://localhost:4200
echo - Backend API: http://localhost:3000
echo - API Documentation: http://localhost:3000/api
echo.
echo Default admin credentials:
echo - Email: admin@traduora.co
echo - Password: admin

pause
