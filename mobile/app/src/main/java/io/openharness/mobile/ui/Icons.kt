package io.openharness.mobile.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.ui.graphics.vector.ImageVector

/** Single mapping table, mirroring src/ui/icons.tsx on the desktop build. */
object HarnessIcons {
    fun of(name: String): ImageVector = when (name) {
        "code" -> Icons.Filled.Code
        "search" -> Icons.Filled.Search
        "check" -> Icons.Filled.CheckCircle
        "globe" -> Icons.Filled.Public
        "edit" -> Icons.Filled.Edit
        "shield" -> Icons.Filled.Security
        "layers" -> Icons.Filled.Layers
        "chart" -> Icons.Filled.BarChart
        "workflow" -> Icons.Filled.AccountTree
        "settings" -> Icons.Filled.Settings
        "plus" -> Icons.Filled.Add
        "send" -> Icons.Filled.ArrowUpward
        "users" -> Icons.Filled.Person
        "chat" -> Icons.Outlined.ChatBubbleOutline
        "stop" -> Icons.Filled.Stop
        else -> Icons.Filled.AutoAwesome
    }

    val logo: ImageVector get() = Icons.Filled.ArrowUpward
}
