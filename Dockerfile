# The toolbox is one file of stdlib Node serving five static directories — no
# dependencies, so no install step and no build stage.
#
# Only each app's dist/ is copied in, not the whole submodule: the apps' sources
# and generated data are several megabytes of things the browser never asks for.
# The layout matches the source tree exactly (apps/<repo>/dist), so `node
# server.mjs` behaves identically in a checkout and in the image.
#
# node:22-alpine is multi-arch, so the Pi builds this unchanged.
FROM node:22-alpine

RUN addgroup -S pf2e && adduser -S -G pf2e pf2e

WORKDIR /app
COPY server.mjs ./
COPY web/ ./web/
COPY apps/pf2epartytracker/dist/ ./apps/pf2epartytracker/dist/
COPY apps/pf2espellcards/dist/   ./apps/pf2espellcards/dist/
COPY apps/pf2eprimer/dist/       ./apps/pf2eprimer/dist/
COPY apps/pf2esubsystems/dist/   ./apps/pf2esubsystems/dist/

USER pf2e

ENV PF2E_HOST=0.0.0.0 \
    PF2E_PORT=6670

EXPOSE 6670

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:6670/healthz >/dev/null || exit 1

CMD ["node", "server.mjs"]
