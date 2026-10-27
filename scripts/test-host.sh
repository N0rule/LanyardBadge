#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
binary=$(mktemp /tmp/lanyard-core-test.XXXXXX)
trap 'rm -f "$binary"' EXIT
c++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined -g tests/core_test.cpp -o "$binary"
"$binary"
node tests/codec.test.cjs
node --check web/app.js
python3 scripts/test_flash_layout.py
