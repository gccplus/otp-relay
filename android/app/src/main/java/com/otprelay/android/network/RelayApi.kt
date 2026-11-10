package com.otprelay.android.network

import com.otprelay.android.protocol.ClaimRequest
import com.otprelay.android.protocol.ClaimResponse
import com.otprelay.android.protocol.MessageEnvelope
import com.otprelay.android.protocol.PairingQueryResponse
import com.otprelay.android.protocol.UploadResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class RelayApi(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        .build(),
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val mediaType = "application/json".toMediaType()

    suspend fun claim(
        baseUrl: String,
        sessionId: String,
        request: ClaimRequest,
    ): ClaimResponse = post(
        "$baseUrl/v1/pairing-sessions/$sessionId/claim",
        json.encodeToString(request),
        credential = null,
    )

    suspend fun queryPairing(
        baseUrl: String,
        sessionId: String,
        androidSessionToken: String,
    ): PairingQueryResponse = get(
        "$baseUrl/v1/pairing-sessions/$sessionId",
        androidSessionToken,
    )

    suspend fun upload(
        baseUrl: String,
        credential: String,
        envelope: MessageEnvelope,
    ): UploadResponse = post(
        "$baseUrl/v1/messages",
        json.encodeToString(envelope),
        credential,
    )

    suspend fun revoke(baseUrl: String, credential: String) {
        execute(
            Request.Builder()
                .url("$baseUrl/v1/pairing")
                .delete()
                .header("Authorization", "Bearer $credential")
                .build(),
        )
    }

    private suspend inline fun <reified T> get(
        url: String,
        credential: String,
    ): T {
        val body = execute(
            Request.Builder()
                .url(url)
                .get()
                .header("Authorization", "Bearer $credential")
                .build(),
        )
        return json.decodeFromString(body)
    }

    private suspend inline fun <reified T> post(
        url: String,
        body: String,
        credential: String?,
    ): T {
        val builder = Request.Builder()
            .url(url)
            .post(body.toRequestBody(mediaType))
        credential?.let { builder.header("Authorization", "Bearer $it") }
        return json.decodeFromString(execute(builder.build()))
    }

    private suspend fun execute(request: Request): String = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw RelayApiException(response.code, safeErrorCode(body))
            }
            body
        }
    }

    private fun safeErrorCode(body: String): String =
        runCatching {
            json.parseToJsonElement(body)
                .jsonObject["error"]
                ?.jsonObject
                ?.get("code")
                ?.toString()
                ?.trim('"')
        }.getOrNull() ?: "HTTP_ERROR"
}

class RelayApiException(
    val statusCode: Int,
    val errorCode: String,
) : IOException("Relay request failed: $errorCode ($statusCode)")
