package app.locus.android

import android.net.Uri

/** Mirrors `@locus/shared` isPhonePairingHost: RFC1918, Tailscale CGNAT/MagicDNS, IPv6 ULA. */
object LanHost {
    fun isAllowed(host: String): Boolean {
        val hostname = strip(host)
        if (hostname.isEmpty()) return false
        if (isTailscaleMagicDns(hostname)) return true
        if (hostname.contains(":")) return isPrivateV6(hostname)
        val parts = hostname.split(".")
        if (parts.size != 4) return false
        val nums = parts.map { it.toIntOrNull() ?: return false }
        if (nums.any { it !in 0..255 }) return false
        val a = nums[0]
        val b = nums[1]
        if (a == 10) return true
        if (a == 192 && b == 168) return true
        if (a == 172 && b in 16..31) return true
        if (a == 100 && b in 64..127) return true
        return false
    }

    fun isAllowedNav(uri: Uri, pairedHost: String, pairedPort: Int): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return false
        if (scheme != "https") return false
        val host = uri.host ?: return false
        if (!isAllowed(host)) return false
        if (strip(host) != strip(pairedHost)) return false
        val port = when {
            uri.port != -1 -> uri.port
            scheme == "https" -> 443
            else -> 80
        }
        return port == pairedPort
    }

    private fun strip(host: String): String {
        var hostname = host.trim().lowercase()
        if (hostname.startsWith("[") && hostname.endsWith("]")) {
            hostname = hostname.substring(1, hostname.length - 1)
        }
        if (hostname.startsWith("::ffff:")) hostname = hostname.substring("::ffff:".length)
        return hostname
    }

    private fun isTailscaleMagicDns(hostname: String): Boolean {
        return hostname == "ts.net" ||
            hostname.endsWith(".ts.net") ||
            hostname == "tailscale.net" ||
            hostname.endsWith(".tailscale.net")
    }

    private fun isPrivateV6(hostname: String): Boolean {
        if (hostname == "::1") return false
        if (hostname.startsWith("fe80:")) return true
        if (hostname.startsWith("fc") || hostname.startsWith("fd")) return true
        return false
    }
}
