#!/bin/bash
# Prakasa Work OS — cron wrapper for shared cPanel.
#
# Secrets live outside the repository in:
#   ~/.prakasa-work-os-cron.env
#
# dotenv is preloaded by Node so values are parsed using dotenv syntax
# instead of shell "export $(grep ...)" expansion.

set -euo pipefail

ENV_FILE="${HOME}/.prakasa-work-os-cron.env"
APP_DIR="${HOME}/prakasa-work-os-backend"

if [ ! -r "${ENV_FILE}" ]; then
  echo "ERROR: env file not readable: ${ENV_FILE}" >&2
  exit 1
fi

cd "${APP_DIR}"

NODE_BIN="${NODE_BIN:-/usr/local/bin/node}"
if [ ! -x "${NODE_BIN}" ]; then
  for candidate in \
    /opt/cpanel/ea-nodejs22/bin/node \
    /opt/cpanel/ea-nodejs20/bin/node \
    "$(command -v node 2>/dev/null || true)"
  do
    if [ -n "${candidate}" ] && [ -x "${candidate}" ]; then
      NODE_BIN="${candidate}"
      break
    fi
  done
fi

if [ ! -x "${NODE_BIN}" ]; then
  echo "ERROR: node binary not found. Set NODE_BIN in cron env." >&2
  exit 1
fi

export DOTENV_CONFIG_PATH="${ENV_FILE}"
exec "${NODE_BIN}" -r dotenv/config "$@"
