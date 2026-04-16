# Build Stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# Production Stage
FROM node:20-alpine

# Install postgresql-client for pg_dump and psql
RUN apk add --no-cache postgresql-client

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY start.sh ./
RUN chmod +x start.sh

ENV PORT=3001
EXPOSE 3001

CMD ["./start.sh"]
