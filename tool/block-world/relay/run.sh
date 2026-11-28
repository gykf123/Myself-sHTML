#!/usr/bin/env bash
# 公网中继启动脚本（macOS / Linux）
cd "$(dirname "$0")" || exit 1
exec node server.js "$@"
