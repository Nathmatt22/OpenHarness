package io.openharness.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.openharness.mobile.ui.theme.Tokens

@Composable
fun BrandMark(tokens: Tokens, size: Int = 34) {
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(RoundedCornerShape((size / 3.6).dp))
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFF8B7BF7), Color(0xFF5A8BD4))
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = HarnessIcons.logo,
            contentDescription = "OpenHarness",
            tint = Color.White,
            modifier = Modifier.size((size * 0.55).dp)
        )
    }
}

@Composable
fun BrandBlock(tokens: Tokens) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        BrandMark(tokens)
        Spacer(Modifier.width(10.dp))
        Column {
            Text(
                "OpenHarness",
                color = tokens.text,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                "One Platform. Multiple AI Agents.",
                color = tokens.text3,
                fontSize = 8.5.sp,
                letterSpacing = 0.4.sp
            )
        }
    }
}

@Composable
fun Eyebrow(text: String, tokens: Tokens, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        color = tokens.text3,
        fontSize = 10.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 1.2.sp,
        modifier = modifier
    )
}

@Composable
fun PageTitle(text: String, tokens: Tokens, size: Int = 24) {
    Text(text, color = tokens.text, fontSize = size.sp, fontWeight = FontWeight.SemiBold)
}

@Composable
fun SectionHeader(text: String, tokens: Tokens) {
    Text(
        text,
        color = tokens.text,
        fontSize = 16.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(bottom = 2.dp)
    )
}

@Composable
fun Caption(text: String, tokens: Tokens, modifier: Modifier = Modifier) {
    Text(text, color = tokens.text3, fontSize = 12.sp, modifier = modifier)
}

@Composable
fun Pill(text: String, tokens: Tokens, icon: ImageVector? = null, ok: Boolean? = null) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(99.dp))
            .background(tokens.surface2)
            .padding(horizontal = 9.dp, vertical = 5.dp)
    ) {
        if (ok != null) {
            Box(
                Modifier
                    .size(6.dp)
                    .clip(RoundedCornerShape(99.dp))
                    .background(if (ok) tokens.ok else tokens.danger)
            )
            Spacer(Modifier.width(6.dp))
        }
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = tokens.text2, modifier = Modifier.size(12.dp))
            Spacer(Modifier.width(5.dp))
        }
        Text(text, color = tokens.text2, fontSize = 11.sp)
    }
}

@Composable
fun HarnessButton(
    label: String,
    tokens: Tokens,
    onClick: () -> Unit,
    icon: ImageVector? = null,
    primary: Boolean = false,
    enabled: Boolean = true,
    modifier: Modifier = Modifier
) {
    val background = when {
        !enabled -> tokens.surface2
        primary -> tokens.accent
        else -> tokens.surface
    }
    Row(
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(background)
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 14.dp, vertical = 11.dp)
    ) {
        if (icon != null) {
            Icon(
                icon, contentDescription = null,
                tint = if (primary) Color.White else tokens.text2,
                modifier = Modifier.size(15.dp)
            )
            Spacer(Modifier.width(7.dp))
        }
        Text(
            label,
            color = if (primary) Color.White.copy(alpha = if (enabled) 1f else 0.5f) else tokens.text,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium
        )
    }
}

@Composable
fun HarnessCard(tokens: Tokens, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(tokens.surface)
            .padding(16.dp)
    ) { Column { content() } }
}

@Composable
fun Divider(tokens: Tokens, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(tokens.line))
}
