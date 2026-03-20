FROM node:20-alpine

# Install bash (needed for entrypoint) and curl (for potential debugging)
RUN apk add --no-cache bash curl

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

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
