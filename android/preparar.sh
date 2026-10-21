#!/usr/bin/env bash
# Deja listo lo que la APK necesita y no se guarda en el repo:
#   1. Node.js para Android (libnode.so + headers) en android/app/libnode/
#      Sale de https://github.com/digidem/nodejs-mobile (Node 24, con páginas de 16 KB).
#   2. El motor de Gravity empaquetado en un solo archivo, en android/app/src/main/assets/motor/
# Se corre una vez antes de compilar (la CI lo hace sola). Pide curl, unzip, sha256sum y Node 22+.
set -euo pipefail

NODE_MOVIL=24.20.0-0
NODE_MOVIL_SHA256=f5ffbaf4f2679fa9180b0758c637c2f8fc8828300f95129badf213a028fb37bb
ABI=arm64-v8a

aqui="$(cd "$(dirname "$0")" && pwd)"
raiz="$(cd "$aqui/.." && pwd)"
libnode="$aqui/app/libnode"

if [ "$(cat "$libnode/VERSION" 2>/dev/null)" != "$NODE_MOVIL" ]; then
  echo "Bajando Node.js $NODE_MOVIL para Android…"
  zip="$(mktemp -d)/nodejs-mobile.zip"
  curl -fsSL --retry 4 -o "$zip" \
    "https://github.com/digidem/nodejs-mobile/releases/download/v$NODE_MOVIL/nodejs-mobile-android-$NODE_MOVIL.zip"
  echo "$NODE_MOVIL_SHA256  $zip" | sha256sum -c -
  rm -rf "$libnode"
  mkdir -p "$libnode"
  unzip -q "$zip" "bin/$ABI/*" "include/*" -d "$libnode"
  rm -f "$zip"
  echo "$NODE_MOVIL" > "$libnode/VERSION"
fi

echo "Empaquetando el motor de Gravity…"
cd "$raiz"
[ -d node_modules ] || npm ci --no-audit --no-fund
node bots/empaquetar.mjs android/app/src/main/assets/motor
echo "Listo. Ahora: cd android && gradle :app:assembleDebug"
