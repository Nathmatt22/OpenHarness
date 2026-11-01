package io.openharness.mobile.net

import io.openharness.mobile.data.ProviderInput
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.util.concurrent.TimeUnit

data class WireMessage(val role: String, val content: String)

class ProviderError(message: String) : Exception(message)

private fun fail(message: String): Nothing = throw ProviderError(message)

object Providers {

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(ProviderInput.DEFAULT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val json = "application/json; charset=utf-8".toMediaType()

    fun endpointFor(provider: ProviderInput): String = when (provider.type) {
        "claude" -> ProviderInput.CLAUDE_ENDPOINT
        "openai" -> ProviderInput.OPENAI_ENDPOINT
        else -> {
            val base = provider.baseUrl.trim().trimEnd('/')
            if (base.isEmpty()) fail("Base URL manquante pour l’API personnalisée.")
            if (!base.startsWith("http://") && !base.startsWith("https://")) {
                fail("Base URL HTTP(S) requise pour une API personnalisée.")
            }
            "$base/chat/completions"
        }
    }

    private fun headers(provider: ProviderInput, stream: Boolean): Map<String, String> {
        val out = mutableMapOf("content-type" to "application/json")
        when (provider.type) {
            "claude" -> {
                out["x-api-key"] = provider.apiKey
                out["anthropic-version"] = "2023-06-01"
                if (stream) out["accept"] = "text/event-stream"
            }
            else -> if (provider.apiKey.isNotEmpty()) out["authorization"] = "Bearer ${provider.apiKey}"
        }
        return out
    }

    private fun body(provider: ProviderInput, messages: List<WireMessage>, stream: Boolean): String {
        val root = JSONObject()
        root.put("model", provider.model)
        root.put("stream", stream)
        if (provider.type == "claude") {
            root.put("max_tokens", 4096)
            messages.firstOrNull { it.role == "system" }?.let { root.put("system", it.content) }
            val arr = JSONArray()
            messages.filter { it.role != "system" }.forEach {
                arr.put(JSONObject().put("role", it.role).put("content", it.content))
            }
            root.put("messages", arr)
        } else {
            val arr = JSONArray()
            messages.forEach { arr.put(JSONObject().put("role", it.role).put("content", it.content)) }
            root.put("messages", arr)
        }
        return root.toString()
    }

    private fun build(provider: ProviderInput, messages: List<WireMessage>, stream: Boolean): Request {
        if (provider.model.isBlank()) fail("Model ID requis.")
        val builder = Request.Builder()
            .url(endpointFor(provider))
            .post(body(provider, messages, stream).toRequestBody(json))
        headers(provider, stream).forEach { (k, v) -> builder.header(k, v) }
        return builder.build()
    }

    suspend fun test(provider: ProviderInput): Boolean = withContext(Dispatchers.IO) {
        val request = build(provider, listOf(WireMessage("user", "Reply with the single word OK")), false)
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                fail("${response.code} — ${response.body?.string()?.take(400) ?: "réponse illisible"}")
            }
            true
        }
    }

    /**
     * Streams assistant text deltas as they arrive. Cancelling the collecting
     * coroutine aborts the HTTP call, which is how Stop is implemented.
     */
    fun stream(provider: ProviderInput, messages: List<WireMessage>): Flow<String> = callbackFlow {
        val call = client.newCall(build(provider, messages, true))
        val isClaude = provider.type == "claude"
        try {
            call.execute().use { response ->
                if (!response.isSuccessful) {
                    val detail = response.body?.string()?.take(400) ?: "réponse illisible"
                    close(ProviderError("${response.code} — $detail"))
                    return@callbackFlow
                }
                val stream = response.body?.byteStream()
                if (stream == null) {
                    close(ProviderError("Le fournisseur n’a pas retourné de flux."))
                    return@callbackFlow
                }
                val reader: BufferedReader = stream.bufferedReader()
                val pending = StringBuilder()
                while (!call.isCanceled()) {
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) {
                        if (pending.isNotEmpty()) {
                            val payload = pending.toString()
                            pending.setLength(0)
                            if (payload == "[DONE]") break
                            textOf(payload, isClaude)?.let { trySend(it) }
                        }
                        continue
                    }
                    if (line.startsWith("data:")) {
                        val chunk = line.substring(5).trim()
                        if (pending.isNotEmpty()) pending.append('\n')
                        pending.append(chunk)
                    }
                }
                if (pending.isNotEmpty() && pending.toString() != "[DONE]") {
                    textOf(pending.toString(), isClaude)?.let { trySend(it) }
                }
            }
            close()
        } catch (e: Throwable) {
            if (call.isCanceled()) close() else close(e)
        }
        awaitClose { call.cancel() }
    }.flowOn(Dispatchers.IO)

    private fun textOf(payload: String, isClaude: Boolean): String? = try {
        val parsed = JSONObject(payload)
        parsed.optJSONObject("error")?.let {
            fail(it.optString("message").ifEmpty { "Erreur du fournisseur." })
        }
        val text = if (isClaude) {
            if (parsed.optString("type") == "content_block_delta") {
                parsed.optJSONObject("delta")?.optString("text")
            } else null
        } else {
            parsed.optJSONArray("choices")?.optJSONObject(0)?.optJSONObject("delta")?.optString("content")
        }
        text?.takeIf { it.isNotEmpty() }
    } catch (e: ProviderError) {
        throw e
    } catch (_: Exception) {
        null
    }
}
