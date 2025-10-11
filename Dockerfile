# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# Install deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app
COPY . .

# Expose port (configurable via PORT env)
EXPOSE 3000

# Healthcheck on /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health || exit 1

# Environment variables expected (documented; provided at runtime)
# MONGODB_URI
# EMAIL_USER
# EMAIL_PASS
# PORT

CMD ["node", "server.js"]
