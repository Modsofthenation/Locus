package app.locus.android

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class PairActivity : AppCompatActivity() {
    private var fromDeepLink = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pair)
        val host = findViewById<EditText>(R.id.host)
        val port = findViewById<EditText>(R.id.port)
        val token = findViewById<EditText>(R.id.token)
        val fingerprint = findViewById<EditText>(R.id.fingerprint)
        applyUri(intent.data, host, port, token, fingerprint)
        findViewById<Button>(R.id.connect).setOnClickListener {
            connect(host, port, token, fingerprint)
        }
    }

    private fun connect(
        host: EditText,
        port: EditText,
        token: EditText,
        fingerprint: EditText,
    ) {
        val address = host.text.toString().trim()
        val portValue = port.text.toString().trim().ifEmpty { "7420" }
        val pairing = token.text.toString().trim().replace("-", "").lowercase()
        val fp = RemoteActivity.normalizeFingerprint(fingerprint.text.toString())
        if (address.isEmpty() || pairing.isEmpty()) {
            Toast.makeText(this, "Host and token are required", Toast.LENGTH_SHORT).show()
            return
        }
        if (fp.isEmpty()) {
            Toast.makeText(this, getString(R.string.fingerprint_required), Toast.LENGTH_LONG).show()
            return
        }
        if (!LanHost.isAllowed(address)) {
            Toast.makeText(
                this,
                "Host must be a LAN or Tailscale address, not the public internet",
                Toast.LENGTH_LONG,
            ).show()
            return
        }
        val raw = if (pairing.startsWith("ph_")) pairing else "ph_$pairing"
        if (fromDeepLink) {
            AlertDialog.Builder(this)
                .setTitle(R.string.confirm_pair_title)
                .setMessage(getString(R.string.confirm_pair_message, address, portValue, fp))
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.connect) { _, _ ->
                    startRemote(address, portValue, raw, fp)
                }
                .show()
            return
        }
        startRemote(address, portValue, raw, fp)
    }

    private fun startRemote(address: String, portValue: String, token: String, fingerprint: String) {
        startActivity(
            Intent(this, RemoteActivity::class.java)
                .putExtra(RemoteActivity.EXTRA_HOST, address)
                .putExtra(RemoteActivity.EXTRA_PORT, portValue)
                .putExtra(RemoteActivity.EXTRA_TOKEN, token)
                .putExtra(RemoteActivity.EXTRA_FINGERPRINT, fingerprint),
        )
    }

    private fun applyUri(
        uri: Uri?,
        host: EditText,
        port: EditText,
        token: EditText,
        fingerprint: EditText,
    ) {
        if (uri == null || uri.scheme != "locus") return
        host.setText(uri.getQueryParameter("host").orEmpty())
        port.setText(uri.getQueryParameter("port") ?: "7420")
        token.setText(uri.getQueryParameter("token").orEmpty())
        fingerprint.setText(uri.getQueryParameter("fp").orEmpty())
        fromDeepLink = true
    }
}
