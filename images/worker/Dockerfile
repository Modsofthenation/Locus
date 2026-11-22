# locus-worker for provisioned compute (ECS Fargate). Build from the repository root:
#   docker build -f images/worker/Dockerfile -t locus/worker:0.23.0 .
# Each Locus chat placed on a Fargate worker runs in its own task from this image. The
# task is the sandbox, so the agent runs as a Host guest inside it (no Docker, no KVM).
FROM node:22-bookworm

ARG INSTALL_AGENT_CLIS=1

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    GIT_TERMINAL_PROMPT=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      git \
      patch \
      ca-certificates \
      curl \
      wget \
      unzip \
      openssh-client \
      jq \
      ripgrep \
      python3 \
      python3-pip \
      python3-venv \
      build-essential \
      chromium \
      fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/chromium /usr/local/bin/chromium-browser \
    && ln -sf /usr/bin/chromium /usr/local/bin/google-chrome

COPY images/agent/git-credential-locus /usr/local/bin/git-credential-locus
RUN chmod +x /usr/local/bin/git-credential-locus \
    && git config --system credential.helper /usr/local/bin/git-credential-locus \
    && git config --system user.email locus@local \
    && git config --system user.name Locus

# CLI agent providers (Claude Code, Codex) run inside the task when a chat uses them.
RUN if [ "$INSTALL_AGENT_CLIS" = "1" ]; then \
      npm install -g @anthropic-ai/claude-code @openai/codex && npm cache clean --force; \
    fi

WORKDIR /opt/locus
COPY . .
RUN npm ci --workspace=@locus/worker --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force \
    && chown -R node:node /opt/locus

ENV LOCUS_WORKER_HOME=/home/node/.locus-worker \
    LOCUS_WORKER_HOST=0.0.0.0 \
    LOCUS_WORKER_PORT=7421 \
    LOCUS_WORKER_ALLOW_HOST=1

USER node
EXPOSE 7421
CMD ["/opt/locus/node_modules/.bin/tsx", "/opt/locus/packages/worker/src/main.ts"]
