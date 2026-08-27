# apps/api/Dockerfile
# Multi-Stage-Build: install+build in einem größeren Image, Laufzeit-Image
# enthält nur das Nötigste (kleiner, sichererer Angriffsvektor).

FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/sync-protocol/package.json packages/sync-protocol/package.json
COPY packages/shared-config/package.json packages/shared-config/package.json
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build --workspace=packages/shared-types
RUN npm run build --workspace=packages/sync-protocol
RUN npm run --workspace=apps/api prisma:generate
RUN npm run build --workspace=apps/api

# Eigene, minimale Install-Stage NUR für Produktions-Abhängigkeiten (`npm ci
# --omit=dev`) — unabhängig von der `build`-Stage oben, deren node_modules
# zwangsläufig auch Dev-Tools wie tsx/typescript/vitest enthält (gebraucht
# für die `RUN npm run build …`-Schritte). npm hebt Workspace-Abhängigkeiten
# grundsätzlich in die Wurzel node_modules/ (Hoisting) — `apps/api/
# node_modules` bleibt dabei leer; genau diese Wurzel node_modules/ wird
# unten in die Laufzeit-Stage kopiert (nicht `apps/api/node_modules`, das
# nichts enthält).
FROM node:22-slim AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/sync-protocol/package.json packages/sync-protocol/package.json
COPY packages/shared-config/package.json packages/shared-config/package.json
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Sicherheitsreview 2026-08-27, Befund N7: config/env.ts' HOST-Default ist
# 127.0.0.1 (korrekt für jedes dokumentierte, nicht-containerisierte
# Deployment mit co-lokalisiertem Nginx) — innerhalb eines Containers wäre
# das für den Host nicht erreichbar, da der Zugriff über Dockers eigene
# Portweiterleitung läuft. 0.0.0.0 ist hier tatsächlich richtig; als
# ENV statt nur in docker-compose.yml gesetzt, damit auch ein einfacher
# `docker run` (ohne Compose) sofort funktioniert.
ENV HOST=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/api/prisma ./prisma
# Produktions-node_modules (siehe prod-deps-Stage oben) — enthält u. a. die
# `@lane1/shared-types`/`@lane1/sync-protocol`-Symlinks, die npm relativ
# anlegt (`../../packages/…`); die Zielverzeichnisse dafür werden direkt
# darunter mitkopiert, siehe die beiden COPY-Zeilen für packages/ unten.
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules
# Von `prisma generate` (Build-Stage) erzeugter Client-Code landet ebenfalls
# gehoistet in der Wurzel node_modules/.prisma — kommt daher aus der
# build-Stage, nicht aus prod-deps (dort läuft `prisma generate` nie).
COPY --from=build --chown=node:node /repo/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /repo/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build --chown=node:node /repo/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build --chown=node:node /repo/packages/sync-protocol/dist ./packages/sync-protocol/dist
COPY --from=build --chown=node:node /repo/packages/sync-protocol/package.json ./packages/sync-protocol/package.json
EXPOSE 3000
# node:22-slim bringt einen fertigen, unprivilegierten `node`-User mit —
# der Container läuft NICHT als root (Code-Review, Befund W7).
USER node
# `migrate deploy` wendet die committete Migrationshistorie (apps/api/
# prisma/migrations/, oben mitkopiert) nicht-interaktiv an, BEVOR der
# Server startet (Code-Review, Befund W5) — ersetzt den früher nötigen,
# manuell auszuführenden `prisma db push`-Schritt. Ein leerer Container
# (frischer docker-compose-Postgres) bekommt sein Schema dadurch
# automatisch beim ersten Start; ein Neustart mit bereits vollständig
# migrierter Datenbank ist ein No-op.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
