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
trap sync_back EXIT INT TERM

exec gosu node "$@"
