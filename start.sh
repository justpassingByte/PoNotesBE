#!/bin/sh

# 1. Run migrations to ensure database is up to date
# This connects to the 'postgres' service defined in docker-compose
echo "🚀 Running database migrations..."
npx prisma migrate deploy

# 2. Start the server
echo "🌟 Starting backend server..."
node dist/server.js
