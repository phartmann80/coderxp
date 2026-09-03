# CoderXP Agent Devbox Base Image (Ubuntu 24.04 LTS)
# Provides a persistent Linux developer environment for the AI agent & user.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC
ENV SHELL=/bin/bash

# Install essential developer toolchains
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    build-essential \
    pkg-config \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    jq \
    unzip \
    tar \
    gzip \
    tree \
    htop \
    procps \
    ca-certificates \
    gnupg \
    lsb-release \
    openssh-client \
    sudo \
    locales \
    && rm -rf /var/lib/apt/lists/*

# Set up UTF-8 locale
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

# Install Node.js 24.x LTS & package managers
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g pnpm yarn && \
    rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (gh)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Create developer user (uid 1000) and configure workspace
RUN (userdel -r ubuntu 2>/dev/null || true) && \
    (groupdel ubuntu 2>/dev/null || true) && \
    groupadd -g 1000 developer && \
    useradd -u 1000 -g developer -m -s /bin/bash developer && \
    mkdir -p /workspace && \
    chown -R developer:developer /workspace /home/developer

# Configure non-root developer bash prompt and clean environment (no banners)
RUN echo 'export PS1="developer@coderxp-devbox:\w\$ "' >> /home/developer/.bashrc && \
    echo 'export PORT=3000' >> /home/developer/.bashrc && \
    echo 'export TERM=xterm-256color' >> /home/developer/.bashrc

# Ensure no sudo access for developer
RUN rm -f /etc/sudoers.d/* && sed -i '/%sudo/d' /etc/sudoers

# Copy and install custom git credential helper for T3 enforcement
COPY deploy/devbox/coderxp-git-credential /usr/local/bin/coderxp-git-credential
RUN chmod +x /usr/local/bin/coderxp-git-credential

# Configure default git behavior and custom credential helper script
RUN git config --system init.defaultBranch main && \
    git config --system core.autocrlf false && \
    git config --system safe.directory '*' && \
    git config --system credential.helper /usr/local/bin/coderxp-git-credential

WORKDIR /workspace
USER developer

CMD ["/bin/bash"]

