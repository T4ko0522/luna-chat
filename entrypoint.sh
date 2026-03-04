#!/bin/sh
set -eu

MOUNT_DIR="/mnt/data"

# bind mount → コンテナネイティブ fs にコピー（Landlock 対応）
if [ -d "${MOUNT_DIR}" ]; then
  cp -a "${MOUNT_DIR}/." "${LUNA_HOME}/"
  chown -R node:node "${LUNA_HOME}"
fi

# 終了時に変更を bind mount へ同期
sync_back() {
  if [ -d "${MOUNT_DIR}" ]; then
    rsync -a --delete "${LUNA_HOME}/" "${MOUNT_DIR}/"
  fi
}

on_term() {
  if [ -n "${child_pid:-}" ]; then
    kill -TERM "${child_pid}" 2>/dev/null || true
    set +e
    wait "${child_pid}"
    set -e
  fi
  sync_back
  exit 0
}

trap on_term INT TERM

gosu node "$@" &
child_pid=$!

set +e
wait "${child_pid}"
exit_code=$?
set -e

sync_back
exit "${exit_code}"
