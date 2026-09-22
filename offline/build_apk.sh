#!/usr/bin/env bash
# Офлайн-APK: offline/build_web.sh → android-offline/app/src/main/assets/web → gradle.
# Результат — android-offline/app/build/outputs/apk/release/app-release.apk.
# Выкладка на сайт: cp в /opt/sites/ash-and-iron/data/ash-and-iron-offline.apk
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/offline/build_web.sh"
ASSETS="$ROOT/android-offline/app/src/main/assets/web"
rm -rf "$ASSETS"
mkdir -p "$(dirname "$ASSETS")"
cp -a "$ROOT/offline/build/web" "$ASSETS"
cd "$ROOT/android-offline"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
# clean обязателен, --no-daemon и nice — см. android/README.md «Сборка»
nice -n 10 ./gradlew clean assembleRelease --no-daemon -q
ls -la app/build/outputs/apk/release/app-release.apk
