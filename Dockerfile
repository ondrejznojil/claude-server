FROM node:20-alpine

# Install bash, curl (health checks), su-exec (drop privileges in entrypoint)
RUN apk add --no-cache bash curl su-exec git openssh-client

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code@latest

# Create non-root user (required by --dangerously-skip-permissions)
RUN adduser -D -h /home/app app

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
RUN mkdir -p /home/app/.claude /home/app/.ssh /app/data /workspace \
    && chown -R app:app /home/app /app/data /workspace

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
