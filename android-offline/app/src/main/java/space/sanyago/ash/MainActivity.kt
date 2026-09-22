package space.sanyago.ash

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader

/**
 * Офлайн-сборка «Прах и Железо»: вся игра лежит в assets/web и работает без сети.
 *
 * Это та же браузерная игра, что на сайте (ветка `offline`): симуляция — тот же JS,
 * а вместо сервера на /api/… отвечает static/js/offline/api.js, профиль — в
 * localStorage WebView. Файлы раздаются через WebViewAssetLoader с настоящего
 * https-origin, поэтому абсолютные пути /static/…, ES-модули и localStorage
 * работают так же, как в браузере, — file:// не дал бы ни того, ни другого.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var assets: WebViewAssetLoader

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        // "/" → assets/web/: index.html и /static/… лежат ровно так же, как на сайте.
        assets = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this).let { h ->
                WebViewAssetLoader.PathHandler { path -> h.handle("web/$path") }
            })
            .build()

        setupWebView()
        applyImmersive()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = handleBack()
        })

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(GAME_URL)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val s = web.settings
        s.javaScriptEnabled = true
        // Профиль игрока (реликвии, открытия, заказы) живёт в localStorage.
        s.domStorageEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.useWideViewPort = true
        s.loadWithOverviewMode = false
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.displayZoomControls = false
        // Всё из assets: HTTP-кэш не нужен, а устаревший после обновления APK вреден.
        s.cacheMode = WebSettings.LOAD_NO_CACHE
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.userAgentString = s.userAgentString + " " + UA_MARKER

        web.setBackgroundColor(getColor(R.color.bg))
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        web.keepScreenOn = true

        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = assets.shouldInterceptRequest(request.url)

            // Никаких переходов наружу: сети у сборки нет по определению.
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean = request.url.host != WebViewAssetLoader.DEFAULT_DOMAIN
        }
    }

    /** Во время забега «Назад» — пауза (игра отвечает true), иначе — в фон. */
    private fun handleBack() {
        web.evaluateJavascript(BACK_JS) { result ->
            if (result != "true") moveTaskToBack(true)
        }
    }

    private fun applyImmersive() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersive()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        web.onPause()
        web.pauseTimers()
    }

    override fun onResume() {
        super.onResume()
        web.resumeTimers()
        web.onResume()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    private companion object {
        const val GAME_URL = "https://${WebViewAssetLoader.DEFAULT_DOMAIN}/index.html"
        const val UA_MARKER = "AshAndIronOffline/1.0"

        const val BACK_JS =
            "(function(){try{return !!(window.__ashBack&&window.__ashBack());}" +
                "catch(e){return false;}})()"
    }
}
