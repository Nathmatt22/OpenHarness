package io.openharness.mobile.util

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import io.openharness.mobile.data.FolderListing
import io.openharness.mobile.data.WorkspaceEntry

/**
 * Read-only file access for team missions, confined to the folders explicitly
 * assigned to a team. On Android those folders are Storage Access Framework
 * tree URIs, so the platform itself enforces the boundary — the app can only
 * ever see inside the grants the user handed over.
 */
object Workspace {

    const val MAX_LIST_ENTRIES = 200
    const val MAX_FILE_BYTES = 64L * 1024

    class PolicyError(message: String) : Exception(message)

    private fun fail(message: String): Nothing = throw PolicyError(message)

    fun isPolicy(e: Throwable): Boolean = e is PolicyError

    fun list(context: Context, folders: List<String>): List<FolderListing> = folders.map { raw ->
        val tree = DocumentFile.fromTreeUri(context, Uri.parse(raw))
            ?: fail("Dossier illisible : ${display(raw)}")
        if (!tree.canRead()) fail("Accès refusé au dossier : ${display(raw)}")
        val entries = tree.listFiles()
            .sortedBy { it.name?.lowercase() ?: "" }
            .take(MAX_LIST_ENTRIES)
            .map { WorkspaceEntry(it.name ?: "(sans nom)", it.isDirectory, it.length()) }
        FolderListing(display(raw), entries)
    }

    fun read(context: Context, folders: List<String>, relative: String): String {
        val clean = relative.trim().trimStart('/', '\\')
        if (clean.isEmpty() || clean.contains("..")) fail("Chemin de fichier invalide.")
        for (raw in folders) {
            val tree = DocumentFile.fromTreeUri(context, Uri.parse(raw)) ?: continue
            val target = locate(tree, clean) ?: continue
            if (target.isDirectory) fail("La cible est un dossier, pas un fichier.")
            if (target.length() > MAX_FILE_BYTES) {
                fail("Fichier trop volumineux (${target.length() / 1024} Ko, max 64 Ko).")
            }
            val bytes = context.contentResolver.openInputStream(target.uri)?.use { it.readBytes() }
                ?: fail("Fichier illisible.")
            if (looksBinary(bytes)) fail("Fichier binaire non lisible en tant que texte.")
            return String(bytes, Charsets.UTF_8)
        }
        fail("Fichier introuvable dans les dossiers assignés.")
    }

    private fun locate(root: DocumentFile, path: String): DocumentFile? {
        var current: DocumentFile = root
        for (segment in path.split('/', '\\').filter { it.isNotEmpty() }) {
            val next = current.findFile(segment) ?: return null
            current = next
        }
        return current
    }

    private fun looksBinary(bytes: ByteArray): Boolean {
        val limit = minOf(bytes.size, 8000)
        for (i in 0 until limit) if (bytes[i] == 0.toByte()) return true
        return false
    }

    /** Human-readable trailing path of a tree URI, for display only. */
    fun display(raw: String): String {
        val decoded = Uri.decode(raw)
        val marker = ":"
        val tail = decoded.substringAfterLast(marker, decoded)
        return tail.trimEnd('/').substringAfterLast('/').ifEmpty { decoded }
    }

    /** Extract file requests the model expressed as "READ: <relative path>" lines. */
    fun parseReadRequests(content: String, limit: Int = 5): List<String> {
        val regex = Regex("^[ \\t]*READ:[ \\t]+(.+?)[ \\t]*$", setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE))
        return regex.findAll(content).take(limit).map { it.groupValues[1].trim() }.filter { it.isNotEmpty() }.toList()
    }
}
