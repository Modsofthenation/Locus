FROM node:22-bookworm

ARG TARGETARCH
ARG CODE_SERVER_VERSION=4.96.4

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
      iptables \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-venv \
      build-essential \
      ffmpeg \
      xvfb \
      chromium \
      fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/chromium /usr/local/bin/chromium-browser \
    && ln -sf /usr/bin/chromium /usr/local/bin/google-chrome

COPY vendor/ /tmp/vendor/
RUN ARCH="$(case "${TARGETARCH:-amd64}" in arm64) echo arm64 ;; *) echo amd64 ;; esac)" \
    && if [ -f /tmp/vendor/code-server.tar.gz ]; then \
         tar -xz -C /opt -f /tmp/vendor/code-server.tar.gz; \
       else \
         curl --retry 8 --retry-all-errors --retry-delay 10 --fail -fsSL \
           "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-${ARCH}.tar.gz" \
           | tar -xz -C /opt; \
       fi \
    && ln -s "/opt/code-server-${CODE_SERVER_VERSION}-linux-${ARCH}/bin/code-server" /usr/local/bin/code-server \
    && printf '%s\n' '#!/bin/sh' 'exec code-server --auth none --bind-addr 127.0.0.1:3999 --user-data-dir /tmp/locus-code /workspace "$@"' \
      > /usr/local/bin/locus-code-server \
    && chmod +x /usr/local/bin/locus-code-server \
    && rm -rf /tmp/vendor

COPY git-credential-locus /usr/local/bin/git-credential-locus
RUN chmod +x /usr/local/bin/git-credential-locus \
    && git config --system credential.helper /usr/local/bin/git-credential-locus \
    && git config --system user.email locus@local \
    && git config --system user.name Locus

WORKDIR /workspace
USER node
CMD ["tail", "-f", "/dev/null"]
