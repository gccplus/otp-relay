#!/bin/sh
set -eu

ENV_FILE="${1:-.env.production}"
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.nginx.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE." >&2
  exit 1
fi

docker compose $COMPOSE_FILES --env-file "$ENV_FILE" config >/dev/null
docker compose $COMPOSE_FILES --env-file "$ENV_FILE" up -d --build postgres redis app
docker compose $COMPOSE_FILES --env-file "$ENV_FILE" ps
