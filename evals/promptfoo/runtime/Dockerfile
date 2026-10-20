FROM node:22.12.0-bookworm-slim AS base

ARG COPILOT_VERSION=1.0.99-3
ARG MINIME_PAYLOAD_COMMIT=unknown

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @github/copilot@${COPILOT_VERSION}

RUN mkdir -p /opt/minime /work/repo /work/runtime /work/hq /work/home /work/copilot /work/cache /work/scratch \
  && chown -R 1000:1000 /opt/minime /work

FROM base AS runtime-default

RUN rm -rf /opt/minime/*
USER 1000:1000
WORKDIR /work/repo

FROM base AS runtime-minime

ARG MINIME_PAYLOAD_SHA=unknown
COPY .payload-staging/payload/.claude-plugin/ /opt/minime/.claude-plugin/
COPY .payload-staging/payload/.github/extensions/ /opt/minime/.github/extensions/
COPY .payload-staging/payload/agents/ /opt/minime/agents/
COPY .payload-staging/payload/assets/ /opt/minime/assets/
COPY .payload-staging/payload/skills/ /opt/minime/skills/
COPY .payload-staging/payload/hooks/ /opt/minime/hooks/
COPY .payload-staging/payload/.payload-commit .payload-staging/payload/.candidate-manifest.jso[n] /opt/minime/
RUN test -f /opt/minime/.claude-plugin/plugin.json \
  && test -f /opt/minime/agents/dr-evil.md \
  && test -f /opt/minime/hooks/session-start.js \
  && printf '%s\n' "${MINIME_PAYLOAD_SHA}" > /opt/minime/.payload-sha \
  && printf '%s\n' "${MINIME_PAYLOAD_COMMIT}" > /opt/minime/.payload-source-commit \
  && chmod -R a-w /opt/minime

USER 1000:1000
WORKDIR /work/repo
