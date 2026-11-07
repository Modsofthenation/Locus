package app.locus.android

import android.annotation.SuppressLint
import android.net.Uri
import android.net.http.SslCertificate
import android.net.http.SslError
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import java.net.URLEncoder
import java.security.MessageDigest

class RemoteActivity : AppCompatActivity() {
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_remote)
        val host = intent.getStringExtra(EXTRA_HOST)?.trim().orEmpty()
        val port = intent.getStringExtra(EXTRA_PORT)?.trim().orEmpty().ifEmpty { "7420" }
        val token = intent.getStringExtra(EXTRA_TOKEN)?.trim().orEmpty()
        val fingerprint = normalizeFingerprint(intent.getStringExtra(EXTRA_FINGERPRINT).orEmpty())
        val portNum = port.toIntOrNull() ?: 7420
        if (!LanHost.isAllowed(host)) {
            Toast.makeText(
                this,
                "Host must be a LAN or Tailscale address, not the public internet",
                Toast.LENGTH_LONG,
            ).show()
            finish()
            return
        }
        if (fingerprint.isEmpty()) {
            Toast.makeText(this, getString(R.string.fingerprint_required), Toast.LENGTH_LONG).show()
            finish()
            return
        }
        val hostPart = if (host.contains(":") && !host.startsWith("[")) "[$host]" else host
        val url = "https://$hostPart:$portNum/"
        val web = findViewById<WebView>(R.id.web)
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(web, false)
        cookies.setCookie(
            url,
            "locus_phone=${URLEncoder.encode(token, "UTF-8")}; Path=/; Secure",
        )
        cookies.flush()
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.webViewClient = LockedClient(host, portNum, fingerprint)
        web.webChromeClient = WebChromeClient()
        web.loadUrl(url, mapOf("Authorization" to "Bearer $token"))
    }

    private class LockedClient(
        private val pairedHost: String,
        private val pairedPort: Int,
        fingerprint: String,
    ) : WebViewClient() {
        private val want = normalizeFingerprint(fingerprint)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            return !LanHost.isAllowedNav(request.url, pairedHost, pairedPort)
        }

        @Deprecated("Deprecated in Java")
        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
            return !LanHost.isAllowedNav(Uri.parse(url), pairedHost, pairedPort)
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            val got = certSha256(error.certificate)
            if (want.isNotEmpty() && got == want) {
                handler.proceed()
                return
            }
            handler.cancel()
        }
    }

    companion object {
        const val EXTRA_HOST = "host"
        const val EXTRA_PORT = "port"
        const val EXTRA_TOKEN = "token"
        const val EXTRA_FINGERPRINT = "fingerprint"

        fun normalizeFingerprint(raw: String): String {
            return raw.trim().lowercase().replace(":", "").removePrefix("sha256")
        }

        fun certSha256(cert: SslCertificate): String? {
            val bytes = SslCertificate.saveState(cert).getByteArray("x509-certificate") ?: return null
            val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
            return digest.joinToString("") { "%02x".format(it) }
        }
    }
}
