package app.mustela.nativecall

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Secrets (sign-in tokens) encrypted with a key that lives in the Android Keystore: the key can't be read out of the
 * phone, so a copy of Mustela's files (a backup, a rooted file browser) holds only scrambled bytes.
 *
 * Used for the page's tokens (vault commands) and for the copies the background notifier keeps.
 */
object Vault {
    private const val ALIAS = "mustela.vault.v1"
    private const val PREFS = "mustela.vault"
    private const val TAG_BITS = 128

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    /** "v1:<iv>:<ciphertext>" in base64, or null if the Keystore isn't usable. */
    fun encrypt(plain: String): String? = runCatching {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val ct = c.doFinal(plain.toByteArray(Charsets.UTF_8))
        "v1:" + Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)
    }.getOrNull()

    /** The plain text, or null if it isn't ours or can't be read (a different key, damaged data). */
    fun decrypt(sealed: String?): String? {
        if (sealed == null || !sealed.startsWith("v1:")) return null
        val parts = sealed.split(":")
        if (parts.size != 3) return null
        return runCatching {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, Base64.decode(parts[1], Base64.NO_WRAP)))
            String(c.doFinal(Base64.decode(parts[2], Base64.NO_WRAP)), Charsets.UTF_8)
        }.getOrNull()
    }

    /** Reads a value saved with [seal]; a value saved before encryption (plain text) is still read, once. */
    fun open(stored: String?): String? = if (stored == null) null else if (stored.startsWith("v1:")) decrypt(stored) else stored

    /** For saving: encrypted when possible (plain only if the Keystore can't be used on this phone). */
    fun seal(plain: String): String = encrypt(plain) ?: plain

    /* ---------- the page's tokens, one entry per account ---------- */

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun available(): Boolean = decrypt(encrypt("ok")) == "ok"

    fun get(ctx: Context, account: String): String? = decrypt(prefs(ctx).getString("s:$account", null))

    fun put(ctx: Context, account: String, secret: String): Boolean {
        val sealed = encrypt(secret) ?: return false
        return prefs(ctx).edit().putString("s:$account", sealed).commit()
    }

    fun remove(ctx: Context, account: String) { prefs(ctx).edit().remove("s:$account").apply() }
}
