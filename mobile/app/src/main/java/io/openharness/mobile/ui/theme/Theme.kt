package io.openharness.mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color

/** Same token system as the desktop CSS. */
data class Tokens(
    val bg: Color,
    val surface: Color,
    val surface2: Color,
    val surface3: Color,
    val line: Color,
    val lineStrong: Color,
    val text: Color,
    val text2: Color,
    val text3: Color,
    val accent: Color,
    val accentSoft: Color,
    val danger: Color,
    val ok: Color
)

val DarkTokens = Tokens(
    bg = Color(0xFF0C0D11),
    surface = Color(0xFF14161B),
    surface2 = Color(0xFF1A1C23),
    surface3 = Color(0xFF22242E),
    line = Color(0xFF272932),
    lineStrong = Color(0xFF343745),
    text = Color(0xFFE8E9EE),
    text2 = Color(0xFFA2A5B2),
    text3 = Color(0xFF6D7080),
    accent = Color(0xFF8B7BF7),
    accentSoft = Color(0x1F8B7BF7),
    danger = Color(0xFFF2727F),
    ok = Color(0xFF52D1A0)
)

val LightTokens = Tokens(
    bg = Color(0xFFF4F4F8),
    surface = Color(0xFFFFFFFF),
    surface2 = Color(0xFFF6F5FA),
    surface3 = Color(0xFFECECF3),
    line = Color(0xFFE3E3EC),
    lineStrong = Color(0xFFCFCEDD),
    text = Color(0xFF23242A),
    text2 = Color(0xFF5D6070),
    text3 = Color(0xFF9A9DAF),
    accent = Color(0xFF6F5BD8),
    accentSoft = Color(0x146F5BD8),
    danger = Color(0xFFD6455A),
    ok = Color(0xFF1F9D6B)
)

val LocalTokens = androidx.compose.runtime.staticCompositionLocalOf { DarkTokens }

@Composable
fun HarnessTheme(light: Boolean = isSystemInDarkTheme().not(), content: @Composable () -> Unit) {
    val tokens = if (light) LightTokens else DarkTokens
    val scheme = if (light) {
        lightColorScheme(
            primary = tokens.accent, background = tokens.bg, surface = tokens.surface,
            onPrimary = Color.White, onBackground = tokens.text, onSurface = tokens.text,
            surfaceVariant = tokens.surface2, outline = tokens.line, error = tokens.danger
        )
    } else {
        darkColorScheme(
            primary = tokens.accent, background = tokens.bg, surface = tokens.surface,
            onPrimary = Color.White, onBackground = tokens.text, onSurface = tokens.text,
            surfaceVariant = tokens.surface2, outline = tokens.line, error = tokens.danger
        )
    }
    MaterialTheme(colorScheme = scheme, typography = Typography()) {
        CompositionLocalProvider(LocalTokens provides tokens) {
            content()
        }
    }
}
