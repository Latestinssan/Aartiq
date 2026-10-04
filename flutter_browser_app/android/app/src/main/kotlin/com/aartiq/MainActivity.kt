package com.aartiq

import android.app.Activity
import android.app.SearchManager
import android.app.role.RoleManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.provider.Settings
import android.speech.RecognizerResultsIntent
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugins.GeneratedPluginRegistrant

class MainActivity : FlutterFragmentActivity() {

    private val CHANNEL = "com.aartiq.intent_data"

    // Stores parsed intent data — consumed once by Flutter then cleared
    private var pendingIntent: MutableMap<String, String?> = mutableMapOf()

    // Pending result of the "set as default browser" role request
    private var defaultBrowserResult: MethodChannel.Result? = null

    companion object {
        // Must match the action strings in SearchWidget.kt
        const val ACTION_SEARCH = "com.aartiq.ACTION_SEARCH"
        const val ACTION_VOICE  = "com.aartiq.ACTION_VOICE"
        const val ACTION_AI     = "com.aartiq.ACTION_AI"
        const val EXTRA_QUERY   = "query"

        // Arbitrary code for the RoleManager role dialog result
        private const val REQUEST_SET_DEFAULT_BROWSER = 0x4A21
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        parseIntent(intent)
    }

    // Handles widget tap when the app is already in the foreground/background
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        parseIntent(intent)
    }

    private fun parseIntent(intent: Intent) {
        pendingIntent.clear()
        val action = intent.action ?: return
        if (RecognizerResultsIntent.ACTION_VOICE_SEARCH_RESULTS == action) return

        when (action) {
            // ── Standard browser / OS search intents ────────────────────────────
            Intent.ACTION_VIEW -> {
                pendingIntent["action"] = "view"
                pendingIntent["url"]    = intent.data?.toString()
            }
            Intent.ACTION_SEARCH,
            MediaStore.INTENT_ACTION_MEDIA_SEARCH,
            Intent.ACTION_WEB_SEARCH -> {
                pendingIntent["action"] = "search"
                pendingIntent["query"]  = intent.getStringExtra(SearchManager.QUERY) ?: ""
            }

            // ── Widget: search bar tapped → navigate to home + focus search ─────
            ACTION_SEARCH -> {
                pendingIntent["action"] = "search"
                pendingIntent["query"]  = intent.getStringExtra(EXTRA_QUERY) ?: ""
            }

            // ── Widget: mic icon tapped → trigger voice input ────────────────────
            ACTION_VOICE -> {
                pendingIntent["action"] = "voice"
                pendingIntent["query"]  = intent.getStringExtra(EXTRA_QUERY) ?: ""
            }

            // ── Widget: AI sparkle tapped → open AI chat screen ──────────────────
            ACTION_AI -> {
                pendingIntent["action"] = "ai"
                pendingIntent["query"]  = intent.getStringExtra(EXTRA_QUERY) ?: ""
            }

            else -> {
                pendingIntent["action"] = action
            }
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        GeneratedPluginRegistrant.registerWith(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call: MethodCall, result: MethodChannel.Result ->
                when (call.method) {
                    "getIntentData" -> {
                        // Return a snapshot then clear so Flutter consumes it exactly once
                        result.success(HashMap<String, String?>(pendingIntent))
                        pendingIntent.clear()
                    }
                    "openDefaultBrowserSettings" -> openDefaultBrowserSettings(result)
                    else -> result.notImplemented()
                }
            }
    }

    // Makes Aartiq the default browser: asks for the system browser role on
    // Android 10+, otherwise opens the Default apps settings screen.
    // Answers with "already", "granted", "settings" or "denied".
    private fun openDefaultBrowserSettings(result: MethodChannel.Result) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val roleManager = getSystemService(RoleManager::class.java)
                if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_BROWSER)) {
                    if (roleManager.isRoleHeld(RoleManager.ROLE_BROWSER)) {
                        result.success("already")
                        return
                    }
                    val requestIntent = roleManager.createRequestRoleIntent(RoleManager.ROLE_BROWSER)
                    if (requestIntent != null) {
                        defaultBrowserResult = result
                        startActivityForResult(requestIntent, REQUEST_SET_DEFAULT_BROWSER)
                        return
                    }
                }
            }

            // Older Android / no role support: let the user pick manually.
            startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
            result.success("settings")
        } catch (e: Exception) {
            defaultBrowserResult = null
            result.error("open_default_browser_settings", e.message, null)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_SET_DEFAULT_BROWSER) {
            val result = defaultBrowserResult
            defaultBrowserResult = null
            result?.success(if (resultCode == Activity.RESULT_OK) "granted" else "denied")
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }
}
