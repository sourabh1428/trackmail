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
# EMAIL_USER              — SES verified sender (connector order 1)
# AWS_ACCESS_KEY_ID
# AWS_SECRET_ACCESS_KEY
# AWS_REGION              — default: ap-south-1
# EMAIL_REPLY_TO          — reply-to address (defaults to EMAIL_USER)
# EMAIL_USER2             — Gmail connector (connector order 2)
# EMAIL_PASS2             — Gmail App Password for EMAIL_USER2
# EMAIL_USER3             — optional second Gmail account (connector order 3)
# EMAIL_PASS3
# EMAIL_USER4             — optional third Gmail account (connector order 4)
# EMAIL_PASS4
# resend_api_key          — Resend connector (connector order 5)
# DASHBOARD_PASSWORD
# JWT_SECRET
# TRACK_SECRET
# DASHBOARD_ORIGIN        — allowed CORS origin
# TRACKING_WORKER_URL     — Cloudflare Worker base URL
# PORT

CMD ["node", "server.js"]
