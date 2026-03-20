FROM node:20-alpine

# Install bash (needed for entrypoint)
RUN apk add --no-cache bash

# Install Claude Code CLI globally (pinned version)
RUN npm install -g @anthropic-ai/claude-code@2.1.80

WORKDIR /app

# Install Node.js dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application source
COPY src/ ./src/

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Runtime directories (actual data comes from volumes)
RUN mkdir -p /root/.claude data

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
