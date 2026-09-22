import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Ключ подписи — из signing.properties рядом с проектом (в git не коммитится,
// см. README «Как выпустить APK»). Нет файла → release просто соберётся
// неподписанным, а debug вообще не зависит от него.
val signingProps: Properties? = rootProject.file("signing.properties")
    .takeIf { it.exists() }
    ?.let { f -> Properties().apply { f.inputStream().use { load(it) } } }

android {
    namespace = "space.sanyago.ash"
    compileSdk = 35

    defaultConfig {
        // Отдельный id: офлайн-версия ставится рядом с онлайн-оболочкой, а не поверх.
        applicationId = "space.sanyago.ash.offline"
        // minSdk 28 (Android 9): ниже начинаются WebView без современного
        // движка Chromium из системного апдейта, а на них canvas-игра с
        // предсказанием ввода всё равно не выдаёт кадр за 16 мс.
        minSdk = 28
        targetSdk = 35
        versionCode = 2
        versionName = "1.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            signingProps?.let { p ->
                signingConfig = signingConfigs.create("release") {
                    storeFile = file(p.getProperty("storeFile"))
                    storePassword = p.getProperty("storePassword")
                    keyAlias = p.getProperty("keyAlias")
                    keyPassword = p.getProperty("keyPassword")
                }
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { viewBinding = false }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    // Splash-экран штатным API — тот же приём, что в диктофоне.
    implementation("androidx.core:core-splashscreen:1.0.1")
    // OnBackPressedDispatcher: аппаратная «Назад» уходит в игру, а не закрывает
    // приложение посреди забега.
    implementation("androidx.activity:activity-ktx:1.9.1")
    // WebViewAssetLoader: игра из assets с https-origin — ES-модули, абсолютные
    // пути /static/… и localStorage работают как на сайте (file:// так не умеет).
    implementation("androidx.webkit:webkit:1.11.0")
    // appcompat не нужен: тема берётся из системной Material, а инсеты и
    // immersive-режим приезжают с core-ktx (WindowCompat).
    // Compose сознательно НЕ подключаем: весь экран занимает WebView, рисовать
    // нативно нечего, а Compose стоил бы ~1.5 МБ APK и целого слоя зависимостей.
}
