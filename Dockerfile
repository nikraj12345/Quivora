# Multi-stage Dockerfile for Quivora (Frontend + Backend + Supervisor)

# --- Stage 1: Build Next.js Frontend ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY quivora-frontend/package*.json ./
RUN npm ci

COPY quivora-frontend/ ./
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

# --- Stage 2: Final Combined Image ---
FROM python:3.12-slim

WORKDIR /app

# Install Node.js, Supervisor, and system build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl build-essential libpq-dev supervisor && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Backend Python dependencies
COPY quivora-backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# Copy Backend Source
COPY quivora-backend/ ./backend

# Copy Built Frontend Application
COPY --from=frontend-builder /app/frontend ./frontend

# Configure Supervisor to run FastAPI on :8100 and Next.js on :3000 (or $PORT)
RUN mkdir -p /etc/supervisor/conf.d
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 3000 8100

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
