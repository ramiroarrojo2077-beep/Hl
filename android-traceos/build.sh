#!/usr/bin/env bash
# Compila TRACE/OS como APK sin Android SDK.
# Requiere en $TOOLS: apktool.jar, signer.jar (uber-apk-signer), dx.jar (dalvik-dx), android-all.jar (robolectric).
set -euo pipefail
cd "$(dirname "$0")"
TOOLS="${TOOLS:?definí TOOLS con la carpeta de herramientas}"
OUT=build
rm -rf "$OUT" && mkdir -p "$OUT/classes" "$OUT/dex"

javac -nowarn --release 8 -cp "$TOOLS/android-all.jar" -d "$OUT/classes" $(find src -name '*.java')
java -cp "$TOOLS/dx.jar" com.android.dx.command.Main --dex --min-sdk-version=24 --output="$OUT/dex/classes.dex" "$OUT/classes"

java -jar "$TOOLS/apktool.jar" b app -o "$OUT/unsigned.apk" -p "$OUT/framework"
(cd "$OUT/dex" && zip -q -0 ../unsigned.apk classes.dex)

java -jar "$TOOLS/signer.jar" -a "$OUT/unsigned.apk" -o "$OUT/signed" --allowResign
cp "$OUT"/signed/*.apk TRACEOS.apk
echo "OK -> $(pwd)/TRACEOS.apk"
