package space.sanyago.ash

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Оболочка над https://ash.sanyago.space.
 *
 * Игра — canvas + socket.io в браузере, вся симуляция живёт в JS, сервер держит
 * сессию, конфиг, сид забега и релей комнат. Поэтому нативного клиента здесь нет
 * и быть не должно: вторая ветка симуляции разъехалась бы с браузерным хостом в
 * коопе. Оболочка даёт ровно то, чего не даёт вкладка браузера: полный экран без
 * системных панелей, несгасающий экран, аппаратную «Назад» как паузу и понятный
 * экран «нет связи» вместо страницы ошибки Chrome.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var errorBox: View

    /** Главный документ не загрузился — не перекрывать экран ошибки страницей. */
    private var loadFailed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        errorBox = findViewById(R.id.error)
        findViewById<Button>(R.id.retry).setOnClickListener { load() }

        setupWebView()
        applyImmersive()
        keepClearOfCutout()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = handleBack()
        })

        // restoreState возвращает null, если состояние не восстановилось —
        // тогда грузим заново, иначе остался бы пустой белый экран.
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            load()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        // Музыка забега — обычный WebAudio/ogg; без этого первый трек не заиграет
        // до касания, а игра разблокирует звук своим pointerdown сама.
        s.mediaPlaybackRequiresUserGesture = false
        // Метатег viewport на странице должен работать так же, как в браузере.
        s.useWideViewPort = true
        s.loadWithOverviewMode = false
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.displayZoomControls = false
        s.cacheMode = WebSettings.LOAD_DEFAULT
        // Маркер оболочки: по нему страница прячет баннер «скачать APK».
        s.userAgentString = s.userAgentString + " " + UA_MARKER

        web.setBackgroundColor(getColor(R.color.bg))
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        web.keepScreenOn = true

        // Сессия Flask — обычная кука первой стороны (SameSite=Lax), поэтому
        // отдельный токен-флоу не нужен: логин переживает перезапуск приложения.
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(web, false)

        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                if (request.url.host == GAME_HOST) return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    true
                } catch (e: ActivityNotFoundException) {
                    true
                }
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                // Отсутствующий спрайт — штатная деградация игры (CLAUDE.md §3.3),
                // экран ошибки положен только упавшему главному документу.
                if (request.isForMainFrame) showError()
            }

            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                response: WebResourceResponse,
            ) {
                if (request.isForMainFrame && response.statusCode >= 500) showError()
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!loadFailed) showGame()
            }
        }
    }

    private fun load() {
        loadFailed = false
        errorBox.visibility = View.GONE
        web.visibility = View.VISIBLE
        // Именно loadUrl, а не reload(): после провалившейся загрузки история
        // пуста и перезагружать нечего.
        web.loadUrl(GAME_URL)
    }

    private fun showError() {
        loadFailed = true
        errorBox.visibility = View.VISIBLE
        web.visibility = View.GONE
    }

    private fun showGame() {
        errorBox.visibility = View.GONE
        web.visibility = View.VISIBLE
    }

    /**
     * Аппаратная «Назад». Во время забега это пауза — игра отвечает `true`.
     * Всё остальное сворачивает приложение: возвращаться по истории некуда,
     * единственный переход в ней — со страницы входа в игру.
     */
    private fun handleBack() {
        if (errorBox.visibility == View.VISIBLE) {
            moveTaskToBack(true)
            return
        }
        web.evaluateJavascript(BACK_JS) { result ->
            if (result != "true") moveTaskToBack(true)
        }
    }

    /**
     * Вырез под камеру. Окно рисуется от края до края (edge-to-edge, а на
     * Android 15 с targetSdk 35 иначе и нельзя), поэтому без этого верх игры —
     * HUD, реликвии, кнопки города — уезжал под «чёлку». Сдвигаем WebView на
     * размер выреза; полоса над ней закрашена фоном игры (R.color.bg).
     * Системные панели скрыты immersive-режимом и места не занимают, вырез же
     * остаётся всегда — поэтому берём только displayCutout.
     */
    private fun keepClearOfCutout() {
        val root = web.parent as View
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val c = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            v.setPadding(c.left, c.top, c.right, c.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(root)
    }

    private fun applyImmersive() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Панели возвращаются после любого системного диалога — прячем снова.
        if (hasFocus) applyImmersive()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        // Куку сессии сбрасываем на диск здесь: процесс могут убить в фоне.
        CookieManager.getInstance().flush()
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
        const val GAME_HOST = "ash.sanyago.space"
        const val GAME_URL = "https://$GAME_HOST/"
        const val UA_MARKER = "AshAndIronApp/1.0"

        /**
         * Точка входа в игру: `window.__ashBack()` (static/js/main.js) ставит
         * забег на паузу и возвращает true, если было что закрывать.
         */
        const val BACK_JS =
            "(function(){try{return !!(window.__ashBack&&window.__ashBack());}" +
                "catch(e){return false;}})()"
    }
}
