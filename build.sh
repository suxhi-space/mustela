#!/usr/bin/env sh
# Build Mustela on macOS or Linux.
#   ./build.sh                       pick a platform from a menu
#   ./build.sh --platform android    build one platform
# Missing tools (Node.js, Rust, Java, Android SDK, Linux libraries) are offered for install.
set -e
cd "$(dirname "$0")"

NODE_VERSION="v22.12.0"
TOOLCHAIN="${MUSTELA_TOOLCHAIN:-$HOME/.mustela/toolchain}"

node_ok() {
  command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ]
}

if ! node_ok && [ -x "$TOOLCHAIN/node/bin/node" ]; then
  PATH="$TOOLCHAIN/node/bin:$PATH"; export PATH
fi

if ! node_ok; then
  echo "Node.js 20+ is needed to run the build."
  printf "Download Node.js %s into %s (for your user only)? [Y/n] " "$NODE_VERSION" "$TOOLCHAIN/node"
  read -r answer || answer="y"
  case "$answer" in [Nn]*) echo "Install it from https://nodejs.org and run this again."; exit 1;; esac
  case "$(uname -s)" in Darwin) os=darwin;; Linux) os=linux;; *) echo "Unsupported system: $(uname -s)"; exit 1;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64;; x86_64|amd64) arch=x64;; *) echo "Unsupported CPU: $(uname -m)"; exit 1;; esac
  name="node-$NODE_VERSION-$os-$arch"
  mkdir -p "$TOOLCHAIN"
  url="https://nodejs.org/dist/$NODE_VERSION/$name.tar.gz"
  echo "Downloading $url"
  if command -v curl >/dev/null 2>&1; then curl -fL --progress-bar "$url" -o "$TOOLCHAIN/node.tar.gz"
  else wget -q --show-progress "$url" -O "$TOOLCHAIN/node.tar.gz"; fi
  rm -rf "$TOOLCHAIN/node" "$TOOLCHAIN/$name"
  tar -xzf "$TOOLCHAIN/node.tar.gz" -C "$TOOLCHAIN"
  mv "$TOOLCHAIN/$name" "$TOOLCHAIN/node"
  rm -f "$TOOLCHAIN/node.tar.gz"
  PATH="$TOOLCHAIN/node/bin:$PATH"; export PATH
  echo "Node.js $(node --version) ready."
fi

exec node scripts/build.mjs "$@"
