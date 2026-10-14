#!/bin/bash
set -e
cd "$(dirname "$0")/.."
if ! command -v node >/dev/null 2>&1; then
  printf '请先安装 Node.js 22.9 或更新版本。\n'
  read -r -p '按回车退出。'
  exit 1
fi
exec npm start
