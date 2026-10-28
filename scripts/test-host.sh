#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
binary=$(mktemp /tmp/lanyard-core-test.XXXXXX)
trap 'rm -f "$binary"' EXIT
c++ -std=c++17 -O2 -Wall -Wextra -Werror -fsanitize=address,undefined -g tests/core_test.cpp -o "$binary"
"$binary"
c++ -std=c++17 -O2 -Wall -Wextra -Werror -fsanitize=address,undefined -g tests/animation_test.cpp -o "$binary"
"$binary"
node tests/codec.test.cjs
node tests/gif.test.cjs
node --check web/app.js
node --check web/gif.js
python3 scripts/test_flash_layout.py
