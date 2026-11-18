# The demo in a Linux container. Windows App Control does not apply inside the container,
# so the native modules (rollup, esbuild, libsql, DuckDB) load normally.
FROM node:22-bookworm-slim

WORKDIR /app
ENV MASTRA_TELEMETRY_DISABLED=1 \
    HOST=0.0.0.0 \
    INCIDENT_DESK_DB=file:/app/data/incident-desk.db \
    INCIDENT_DESK_TRACES=/app/data/traces.duckdb

# packages first, so a code change doesn't reinstall everything
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# the planner UI is not in git (ui-planner/dist is ignored), so build it here
RUN npm run build:planner
# rebundle the Incident Desk client too, so edits in ui-incident-desk/src always reach the image
RUN npm run build:ui
RUN mkdir -p /app/data

EXPOSE 4111
CMD ["npx", "mastra", "dev"]
