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
# Reempaquetar: resources.arsc y classes.dex sin comprimir (requisito de Android 11+)
python3 -I - "$OUT/unsigned.apk" "$OUT/dex/classes.dex" "$OUT/repacked.apk" <<'PY'
import sys, zipfile
src, dex, dst = sys.argv[1:]
STORE = ("resources.arsc", "classes.dex")
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
    items = [(i.filename, zin.read(i)) for i in zin.infolist() if not i.filename.startswith("META-INF/")]
    items.append(("classes.dex", open(dex, "rb").read()))
    for name, data in items:
        stored = name in STORE or name.endswith(".png")
        zout.writestr(name, data, zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED)
PY
mv "$OUT/repacked.apk" "$OUT/unsigned.apk"

java -jar "$TOOLS/signer.jar" -a "$OUT/unsigned.apk" -o "$OUT/signed" --allowResign
cp "$OUT"/signed/*.apk TRACEOS.apk
echo "OK -> $(pwd)/TRACEOS.apk"
