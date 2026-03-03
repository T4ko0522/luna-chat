#!/bin/sh
set -eu

chown -R node:node "${LUNA_HOME}"
exec gosu node "$@"
