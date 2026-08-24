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
RUN npm install --workspaces --if-present --ignore-scripts

COPY . .
RUN npm run build --workspace=packages/shared-types
RUN npm run build --workspace=packages/sync-protocol
RUN npm run --workspace=apps/api prisma:generate
RUN npm run build --workspace=apps/api

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/package.json ./package.json
COPY --from=build /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/prisma ./prisma
COPY --from=build /repo/node_modules ./node_modules_root
EXPOSE 3000
# `migrate deploy` wendet die committete Migrationshistorie (apps/api/
# prisma/migrations/, oben mitkopiert) nicht-interaktiv an, BEVOR der
# Server startet (Code-Review, Befund W5) — ersetzt den früher nötigen,
# manuell auszuführenden `prisma db push`-Schritt. Ein leerer Container
# (frischer docker-compose-Postgres) bekommt sein Schema dadurch
# automatisch beim ersten Start; ein Neustart mit bereits vollständig
# migrierter Datenbank ist ein No-op.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
