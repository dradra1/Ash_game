# Прах и Железо — офлайн-APK

Та же игра, что на https://ash.sanyago.space, но целиком внутри APK: `WebView` грузит
`assets/web/` через `androidx.webkit.WebViewAssetLoader` с origin
`https://appassets.androidplatform.net/`. Сети не нужно, `INTERNET` в манифесте нет.
Вместо сервера на `/api/*` отвечает `static/js/offline/api.js` (CLAUDE.md §11).

`applicationId` — `space.sanyago.ash.offline`: ставится рядом с онлайн-оболочкой
(`android/`), а не поверх неё. Иконки, тема, immersive, keepScreenOn, «Назад» = пауза —
как в `android/` (подробности там же, в `android/README.md`).

## Сборка

```bash
cd /opt/sites/ash-offline
offline/build_apk.sh
```

Скрипт стейджит веб (`offline/build_web.sh`), копирует его в
`app/src/main/assets/web` (генерируется, в git не едет) и выполняет
`gradlew clean assembleRelease --no-daemon` под `nice`. Нужны `local.properties` и
`signing.properties` — копии из `/opt/sites/ash-and-iron/android/` (тот же ключ
`android-keys/ash.jks`).

## Выкладка

```bash
cp android-offline/app/build/outputs/apk/release/app-release.apk \
   /opt/sites/ash-and-iron/data/ash-and-iron-offline.apk
```

Сайт раздаёт его по `/download/apk-offline`, кнопка «Скачать офлайн-версию» — на
странице входа и в меню города.

## Прогресс

Профиль — `localStorage` WebView: переживает перезапуск и обновление APK (подпись и
applicationId те же), теряется при удалении приложения или «Очистить данные». С
онлайн-аккаунтом не связан.
