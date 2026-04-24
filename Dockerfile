FROM node:20-bookworm-slim

# Runtime deps: native sqlite builds + traceroute/ping for network diagnostics
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
      ca-certificates curl \
      iputils-ping traceroute dnsutils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install app deps (better-sqlite3 compiles natively; build tools above satisfy it)
COPY package*.json ./
RUN npm install --omit=dev

# Install Claude Code CLI globally so it's on PATH as `claude`
RUN npm install -g @anthropic-ai/claude-code

# App source
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Persistent storage layout
ENV DB_PATH=/data/incident_manager.db
ENV CLAUDE_CLI_PATH=claude
ENV HOME=/data/home
ENV PORT=3069

EXPOSE 3069

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
