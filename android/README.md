# Прах и Железо — Android-оболочка

APK-обёртка над **https://ash.sanyago.space**. Ничего игрового внутри нет: весь
экран занимает `WebView`, который открывает тот же сайт.

## Почему оболочка, а не нативный клиент

Симуляция игры живёт в браузере (CLAUDE.md §2), сервер держит сессию, конфиг, сид
забега и релей комнат. Нативная копия симуляции на Kotlin была бы второй веткой
той же логики — а две ветки неизбежно разъезжаются, и в коопе, где авторитет у
браузера хоста, это означало бы рассинхрон вместо игры.

Оболочка даёт ровно то, чего не даёт вкладка браузера:

* полный экран без системных панелей (immersive sticky);
* экран не гаснет во время забега (`keepScreenOn`);
* аппаратная «Назад» ставит забег на паузу, а не выкидывает со страницы —
  через `window.__ashBack()` в `static/js/main.js`;
* понятный экран «нет связи» вместо страницы ошибки Chrome;
* сессия Flask переживает перезапуск: кука первой стороны, `CookieManager.flush()`
  в `onPause`.

Мобильное управление (виртуальный джойстик, кнопка паузы, зум камеры под узкий
экран, портретная вёрстка) живёт **в самой игре** — `specs/m9_mobile_touch.md`.
Оболочка про него ничего не знает и работает с обычным мобильным браузером наравне.

## Состав

```
app/src/main/java/space/sanyago/ash/MainActivity.kt   единственный экран
app/src/main/res/layout/activity_main.xml             WebView + экран «нет связи»
app/src/main/res/values/{strings,colors,themes}.xml   палитра совпадает со style.css
icons/build_icons.py                                  иконки из static/favicon.svg
```

Compose сознательно не подключён: рисовать нативно нечего, а он стоил бы ~1.5 МБ
APK ради двух кнопок. Обычная `Activity` + `FrameLayout`.

`applicationId` — `space.sanyago.ash`, `minSdk 28`, `targetSdk/compileSdk 35`,
Java 17, ориентация заперта в портрет.

## Иконки

```bash
python3 icons/build_icons.py
```

Источник один — `static/favicon.svg` (пиксель-арт 32×32, выложенный
прямоугольниками по целым координатам, поэтому парсится напрямую). Скрипт на
чистом Pillow, без сети и без pixellab. Всё масштабирование — `NEAREST`.
Правишь favicon — перегенерируй иконки, иначе метка во вкладке и на рабочем столе
разъедутся.

Генерируются: `mipmap-*/ic_launcher{,_round}.png` (плита целиком),
`mipmap-*/ic_launcher_foreground.png` + `drawable-*/ic_launcher_mono.png` (жаровня
без рамки, для адаптивной иконки), `mipmap-anydpi-v26/ic_launcher{,_round}.xml`,
`drawable-*/ic_splash_logo.png`.

## Сборка

```bash
cd /opt/sites/ash-and-iron/android
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
nice -n 10 ./gradlew clean assembleRelease --no-daemon
```

Результат — `app/build/outputs/apk/release/app-release.apk`.

Почему именно так (грабли, собранные на диктофоне,
`/opt/tgbot/dictaphone/android/README.md`):

* **`clean` перед релизом обязателен.** Инкрементальная пересборка заставляет AGP
  переписывать пакет на месте, и в нём остаётся мусор от прошлой сборки — там это
  дало 55 МБ APK, из которых 30 были ничем.
* **`--no-daemon` и `nice`**, потому что на хосте 5 ГБ памяти на бота и десяток
  контейнеров, а `org.gradle.jvmargs=-Xmx2048m` ограничивает только саму сборку.
* SDK — `/opt/android-sdk` (задан в `local.properties`, который в git не едет),
  лицензии там уже приняты, дистрибутив Gradle 8.7 и кэш зависимостей прогреты.

## Подпись

```bash
keytool -genkeypair -v -keystore /opt/sites/ash-and-iron/android-keys/ash.jks \
    -alias ash -keyalg RSA -keysize 2048 -validity 10000
chmod 600 /opt/sites/ash-and-iron/android-keys/ash.jks
```

Затем `android/signing.properties` (тоже `chmod 600`, в git не едет):

```properties
storeFile=/opt/sites/ash-and-iron/android-keys/ash.jks
storePassword=…
keyAlias=ash
keyPassword=…
```

Нет файла — `assembleRelease` просто соберёт неподписанный APK, сборка не упадёт.

Проверка подписи:

```bash
/opt/android-sdk/build-tools/35.0.0/apksigner verify --print-certs \
    app/build/outputs/apk/release/app-release.apk
```

Потерять ключ = невозможно выпустить обновление поверх установленного приложения.
Отдать ключ = кто угодно выпустит «обновление» от твоего имени.

## Выкладка

APK кладётся в `data/` — это том контейнера, поэтому он не попадает ни в git, ни
в образ, и `docker compose up -d --build` его не трёт:

```bash
cp app/build/outputs/apk/release/app-release.apk \
   /opt/sites/ash-and-iron/data/ash-and-iron.apk
```

Дальше он раздаётся маршрутом `/download/apk` (`app.py`), а на странице входа
появляется кнопка «Android APK». Пока файла нет — маршрут отдаёт 404, кнопки нет.

Установка на устройство:

```bash
adb install -r app/build/outputs/apk/release/app-release.apk
```

или скачать `https://ash.sanyago.space/download/apk` прямо с телефона
(понадобится разрешение «установка из неизвестных источников»).

## Что проверять на устройстве

* логин сохраняется после полного перезапуска приложения (кука);
* системных панелей не видно, под чёлку ничего не уезжает;
* «Назад» во время забега открывает паузу и не сворачивает приложение;
* экран не гаснет в бою;
* музыка играет;
* дебаг-оверлей (пункт «Отладка» в меню паузы) показывает fps и мс рендера —
  бюджет кадра CLAUDE.md §4 проверяется на реальном WebView, а не на десктопе;
* кооп-комната с десктопом собирается и держится.
