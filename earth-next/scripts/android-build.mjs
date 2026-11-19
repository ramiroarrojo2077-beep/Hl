/**
 * Compila la app Android: build web → sincronización Capacitor → APK release (Gradle).
 * Copia el resultado a release/EARTH-NEXT-<versión>.apk.
 * Requiere JDK 21 y Android SDK (ANDROID_HOME o android/local.properties).
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, cwd = root) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: process.env });
};

run("npx vite build");
run("npx cap sync android");
const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
run(`${gradlew} assembleRelease --no-daemon`, path.join(root, "android"));

const gradle = readFileSync(path.join(root, "android", "app", "build.gradle"), "utf8");
const version = gradle.match(/versionName\s+"([^"]+)"/)?.[1] ?? "dev";
const apk = path.join(root, "android", "app", "build", "outputs", "apk", "release", existsSync(path.join(root, "android", "keystore.properties")) ? "app-release.apk" : "app-release-unsigned.apk");
mkdirSync(path.join(root, "release"), { recursive: true });
const out = path.join(root, "release", `EARTH-NEXT-${version}.apk`);
copyFileSync(apk, out);
console.log(`\nAPK listo: ${out}`);
