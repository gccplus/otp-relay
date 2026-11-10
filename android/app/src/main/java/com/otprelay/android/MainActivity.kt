package com.otprelay.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.zxing.client.android.Intents
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.otprelay.android.protocol.PairingConfig
import com.otprelay.android.storage.SmsDeliveryStatus
import com.otprelay.android.storage.SmsLogEntry
import com.otprelay.android.storage.SmsLogStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val AppPrimary = Color(0xFF3461FF)
private val AppPrimaryContainer = Color(0xFFDCE2FF)
private val AppBackground = Color(0xFFF3F3F7)
private val AppSurface = Color(0xFFFFFBFF)
private val AppSurfaceVariant = Color(0xFFE4E1EC)
private val AppText = Color(0xFF1C1B1F)
private val AppMutedText = Color(0xFF49454E)
private val AppSubtleText = Color(0xFF7A7585)
private val AppOutline = Color(0xFFCAC4D0)
private val AppError = Color(0xFFB3261E)
private val AppErrorContainer = Color(0xFFF9DEDC)
private val AppSuccess = Color(0xFF146B3A)
private val AppSuccessContainer = Color(0xFFC8F5D7)
private val AppWarning = Color(0xFF7A3800)
private val AppWarningContainer = Color(0xFFFDECD7)

private val OtpRelayColors = lightColorScheme(
    primary = AppPrimary,
    onPrimary = Color.White,
    primaryContainer = AppPrimaryContainer,
    onPrimaryContainer = Color(0xFF001460),
    secondary = AppMutedText,
    onSecondary = Color.White,
    secondaryContainer = AppSurfaceVariant,
    onSecondaryContainer = AppText,
    background = AppBackground,
    onBackground = AppText,
    surface = AppSurface,
    onSurface = AppText,
    surfaceVariant = AppSurfaceVariant,
    onSurfaceVariant = AppMutedText,
    error = AppError,
    onError = Color.White,
    errorContainer = AppErrorContainer,
    onErrorContainer = Color(0xFF410E0B),
    outline = AppOutline,
    outlineVariant = AppSurfaceVariant,
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = OtpRelayColors) {
                OtpRelayScreen()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OtpRelayScreen(
    viewModel: AppViewModel = viewModel(),
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var pendingUnpairId by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingRenameId by rememberSaveable { mutableStateOf<String?>(null) }
    var permissionGranted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECEIVE_SMS,
            ) == PackageManager.PERMISSION_GRANTED,
        )
    }
    var cameraGranted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.CAMERA,
            ) == PackageManager.PERMISSION_GRANTED,
        )
    }
    var backgroundAllowed by remember {
        mutableStateOf(isBackgroundUnrestricted(context))
    }

    val smsPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        permissionGranted = granted
        viewModel.refresh()
    }
    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let(viewModel::acceptQr)
    }
    val launchScanner: () -> Unit = {
        scanner.launch(
            ScanOptions()
                .setPrompt("扫描电脑端的配对二维码")
                .setBeepEnabled(false)
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .addExtra(Intents.Scan.SCAN_TYPE, Intents.Scan.MIXED_SCAN),
        )
    }
    val cameraPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        cameraGranted = granted
        if (granted) {
            launchScanner()
        } else {
            scope.launch {
                val result = snackbarHostState.showSnackbar(
                    message = "需要相机权限才能扫描配对二维码",
                    actionLabel = "去设置",
                )
                if (result == SnackbarResult.ActionPerformed) {
                    context.startActivity(
                        Intent(
                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:${context.packageName}"),
                        ),
                    )
                }
            }
        }
    }
    val batteryOptimization = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) {
        backgroundAllowed = isBackgroundUnrestricted(context)
        viewModel.refresh()
    }
    val requestBackgroundAccess: () -> Unit = {
        val directRequest = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:${context.packageName}"),
        )
        runCatching {
            batteryOptimization.launch(directRequest)
        }.onFailure {
            batteryOptimization.launch(
                Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            )
        }
        Unit
    }
    val requestCameraAndScan: () -> Unit = {
        if (cameraGranted) {
            launchScanner()
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    DisposableEffect(lifecycleOwner, context) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                permissionGranted =
                    ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.RECEIVE_SMS,
                    ) == PackageManager.PERMISSION_GRANTED
                cameraGranted =
                    ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.CAMERA,
                    ) == PackageManager.PERMISSION_GRANTED
                backgroundAllowed = isBackgroundUnrestricted(context)
                viewModel.refresh()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { contentPadding ->
        when {
            state.paired && permissionGranted && backgroundAllowed -> {
                HealthyContent(
                    state = state,
                    modifier = Modifier.padding(contentPadding),
                    onClearLogs = {
                        viewModel.clearSmsLogs()
                        scope.launch {
                            snackbarHostState.showSnackbar("短信日志已清空")
                        }
                    },
                    onTest = {
                        viewModel.sendTestMessage()
                        scope.launch {
                            delay(850)
                            snackbarHostState.showSnackbar(
                                "测试验证码已加入 ${state.pairedComputers.size} 台电脑的发送队列",
                            )
                        }
                    },
                    onAddComputer = requestCameraAndScan,
                    onRename = { pendingRenameId = it },
                    onUnpair = { pendingUnpairId = it },
                )
            }

            state.paired && !permissionGranted -> {
                PausedContent(
                    permissionIssue = true,
                    pairedCount = state.pairedComputers.size,
                    modifier = Modifier.padding(contentPadding),
                    onAction = {
                        smsPermission.launch(Manifest.permission.RECEIVE_SMS)
                    },
                )
            }

            state.paired -> {
                PausedContent(
                    permissionIssue = false,
                    pairedCount = state.pairedComputers.size,
                    modifier = Modifier.padding(contentPadding),
                    onAction = requestBackgroundAccess,
                )
            }

            state.busy -> {
                PairingWaitingContent(
                    status = state.status,
                    modifier = Modifier.padding(contentPadding),
                )
            }

            else -> {
                InactiveContent(
                    permissionGranted = permissionGranted,
                    status = state.status,
                    modifier = Modifier.padding(contentPadding),
                    onRequestPermission = {
                        smsPermission.launch(Manifest.permission.RECEIVE_SMS)
                    },
                    onPair = requestCameraAndScan,
                )
            }
        }
    }

    val pendingUnpair = state.pairedComputers.firstOrNull {
        it.pairingId == pendingUnpairId
    }
    if (pendingUnpair != null) {
        ModalBottomSheet(
            onDismissRequest = { pendingUnpairId = null },
            containerColor = AppSurface,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 32.dp),
            ) {
                Text(
                    text = "解除与 ${pendingUnpair.computerName} 的配对？",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "设备凭证和待投递消息会立即失效，继续使用时需要重新扫码。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = AppMutedText,
                )
                Spacer(Modifier.height(24.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    OutlinedButton(
                        onClick = { pendingUnpairId = null },
                        shape = CircleShape,
                        modifier = Modifier
                            .weight(1f)
                            .height(48.dp),
                    ) {
                        Text("取消")
                    }
                    Button(
                        onClick = {
                            pendingUnpairId = null
                            viewModel.unpair(pendingUnpair.pairingId) { success ->
                                scope.launch {
                                    snackbarHostState.showSnackbar(
                                        if (success) {
                                            "已解除配对"
                                        } else {
                                            "解除配对失败，请检查网络后重试"
                                        },
                                    )
                                }
                            }
                        },
                        enabled = !state.busy,
                        shape = CircleShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = AppError,
                            contentColor = Color.White,
                        ),
                        modifier = Modifier
                            .weight(1f)
                            .height(48.dp),
                    ) {
                        Text("确认解除")
                    }
                }
            }
        }
    }

    val pendingRename = state.pairedComputers.firstOrNull {
        it.pairingId == pendingRenameId
    }
    if (pendingRename != null) {
        var renameValue by rememberSaveable(pendingRename.pairingId) {
            mutableStateOf(pendingRename.computerName)
        }
        val normalizedName = renameValue.trim()
        val nameError = normalizedName.isEmpty() || renameValue.length > 32
        ModalBottomSheet(
            onDismissRequest = { pendingRenameId = null },
            containerColor = AppSurface,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 32.dp),
            ) {
                Text(
                    text = "修改电脑名称",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "仅修改手机端显示名称，不影响设备凭证或加密密钥",
                    style = MaterialTheme.typography.bodySmall,
                    color = AppSubtleText,
                )
                Spacer(Modifier.height(20.dp))
                OutlinedTextField(
                    value = renameValue,
                    onValueChange = { value ->
                        if (value.length <= 64) renameValue = value
                    },
                    label = { Text("电脑名称") },
                    supportingText = {
                        Row(modifier = Modifier.fillMaxWidth()) {
                            Text(
                                text = when {
                                    normalizedName.isEmpty() -> "名称不能为空"
                                    renameValue.length > 32 -> "最多 32 个字符"
                                    else -> "最多 32 个字符"
                                },
                                modifier = Modifier.weight(1f),
                            )
                            Text("${renameValue.length}/32")
                        }
                    },
                    singleLine = true,
                    isError = nameError,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(20.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Button(
                        onClick = { pendingRenameId = null },
                        shape = CircleShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = AppBackground,
                            contentColor = AppMutedText,
                        ),
                        modifier = Modifier
                            .weight(1f)
                            .height(48.dp),
                    ) {
                        Text("取消")
                    }
                    Button(
                        onClick = {
                            val result = viewModel.renamePairing(
                                pendingRename.pairingId,
                                normalizedName,
                            )
                            if (result.isSuccess) pendingRenameId = null
                            scope.launch {
                                snackbarHostState.showSnackbar(
                                    result.exceptionOrNull()?.message ?: "电脑名称已修改",
                                )
                            }
                        },
                        enabled = !nameError && normalizedName != pendingRename.computerName,
                        shape = CircleShape,
                        modifier = Modifier
                            .weight(2f)
                            .height(48.dp),
                    ) {
                        Text("保存")
                    }
                }
            }
        }
    }
}

@Composable
private fun AppHeader(
    title: String = "验证码同步",
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = AppSurface,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(30.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(AppPrimary),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Default.Email,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(17.dp),
                )
            }
            Spacer(Modifier.width(9.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun HealthyContent(
    state: AppUiState,
    modifier: Modifier = Modifier,
    onClearLogs: () -> Unit,
    onTest: () -> Unit,
    onAddComputer: () -> Unit,
    onRename: (String) -> Unit,
    onUnpair: (String) -> Unit,
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    var expandedLogId by rememberSaveable { mutableStateOf<String?>(null) }
    val displayLogs = state.smsLogs.filter { it.status != SmsLogStatus.UNRECOGNIZED }
    val visibleLogs = if (expanded) displayLogs else displayLogs.take(3)

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(AppBackground),
    ) {
        AppHeader()
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 16.dp,
                top = 12.dp,
                end = 16.dp,
                bottom = 28.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                StatusCard(computerCount = state.pairedComputers.size)
            }
            item {
                PairedComputersCard(
                    pairings = state.pairedComputers,
                    enabled = !state.busy,
                    onAddComputer = onAddComputer,
                    onRename = onRename,
                    onUnpair = onUnpair,
                )
            }
            item {
                SectionHeader(
                    title = "最近短信日志",
                    action = if (displayLogs.isEmpty()) null else "清空",
                    actionIcon = Icons.Default.Delete,
                    destructive = true,
                    onAction = onClearLogs,
                )
            }
            if (displayLogs.isEmpty()) {
                item {
                    EmptyLogs(onTest = onTest)
                }
            } else {
                items(
                    items = visibleLogs,
                    key = SmsLogEntry::id,
                ) { entry ->
                    SmsLogCard(
                        entry = entry,
                        expanded = expandedLogId == entry.id,
                        onClick = {
                            expandedLogId =
                                if (expandedLogId == entry.id) null else entry.id
                        },
                    )
                }
                if (displayLogs.size > 3) {
                    item {
                        Box(
                            modifier = Modifier.fillMaxWidth(),
                            contentAlignment = Alignment.Center,
                        ) {
                            TextButton(
                                onClick = {
                                    expanded = !expanded
                                    if (!expanded) expandedLogId = null
                                },
                            ) {
                                Icon(
                                    imageVector =
                                        if (expanded) {
                                            Icons.Default.KeyboardArrowUp
                                        } else {
                                            Icons.Default.KeyboardArrowDown
                                        },
                                    contentDescription = null,
                                    modifier = Modifier.size(17.dp),
                                )
                                Spacer(Modifier.width(3.dp))
                                Text(
                                    if (expanded) {
                                        "收起"
                                    } else {
                                        "展开全部（${displayLogs.size} 条）"
                                    },
                                )
                            }
                        }
                    }
                }
                item {
                    Text(
                        text = "仅在本机加密保存 24 小时\n验证码和短信摘要均已脱敏",
                        style = MaterialTheme.typography.labelSmall,
                        color = AppSubtleText,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                item {
                    TestSyncCard(
                        sending = state.testSending,
                        onTest = onTest,
                    )
                }
            }
        }
    }
}

@Composable
private fun StatusCard(computerCount: Int) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = AppSurface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(AppSuccessContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = null,
                    tint = AppSuccess,
                    modifier = Modifier.size(23.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column {
                Text(
                    text = "同步正常",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "已连接 $computerCount 台电脑",
                    style = MaterialTheme.typography.bodySmall,
                    color = AppMutedText,
                )
            }
        }
    }
}

@Composable
private fun PairedComputersCard(
    pairings: List<PairingConfig>,
    enabled: Boolean,
    onAddComputer: () -> Unit,
    onRename: (String) -> Unit,
    onUnpair: (String) -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = AppSurface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(vertical = 4.dp)) {
            SectionHeader(
                title = "已绑定电脑",
                action = "添加",
                actionIcon = Icons.Default.Add,
                onAction = onAddComputer,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            pairings.forEachIndexed { index, pairing ->
                PairedComputerRow(
                    pairing = pairing,
                    enabled = enabled,
                    onRename = { onRename(pairing.pairingId) },
                    onUnpair = { onUnpair(pairing.pairingId) },
                )
                if (index < pairings.lastIndex) {
                    HorizontalDivider(
                        modifier = Modifier.padding(horizontal = 16.dp),
                        color = AppBackground,
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(
    title: String,
    action: String?,
    actionIcon: ImageVector? = null,
    destructive: Boolean = false,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(44.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            color = AppMutedText,
            modifier = Modifier.weight(1f),
        )
        if (action != null) {
            TextButton(
                onClick = onAction,
                colors = ButtonDefaults.textButtonColors(
                    contentColor = if (destructive) AppError else AppPrimary,
                ),
            ) {
                if (actionIcon != null) {
                    Icon(
                        imageVector = actionIcon,
                        contentDescription = null,
                        modifier = Modifier.size(15.dp),
                    )
                    Spacer(Modifier.width(4.dp))
                }
                Text(action)
            }
        }
    }
}

@Composable
private fun PairedComputerRow(
    pairing: PairingConfig,
    enabled: Boolean,
    onRename: () -> Unit,
    onUnpair: () -> Unit,
) {
    var menuOpen by rememberSaveable(pairing.pairingId) { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 8.dp, top = 9.dp, bottom = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(AppBackground),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Default.Lock,
                contentDescription = null,
                tint = AppText,
                modifier = Modifier.size(19.dp),
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = pairing.computerName,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "已安全配对",
                style = MaterialTheme.typography.labelSmall,
                color = AppSubtleText,
            )
        }
        Box {
            IconButton(
                onClick = { menuOpen = true },
                enabled = enabled,
            ) {
                Icon(
                    imageVector = Icons.Default.MoreVert,
                    contentDescription = "电脑操作",
                    tint = AppSubtleText,
                )
            }
            DropdownMenu(
                expanded = menuOpen,
                onDismissRequest = { menuOpen = false },
                containerColor = AppSurface,
                shape = RoundedCornerShape(12.dp),
            ) {
                DropdownMenuItem(
                    text = { Text("修改名称") },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.Edit,
                            contentDescription = null,
                        )
                    },
                    onClick = {
                        menuOpen = false
                        onRename()
                    },
                )
                HorizontalDivider(color = AppBackground)
                DropdownMenuItem(
                    text = { Text("解除配对", color = AppError) },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = null,
                            tint = AppError,
                        )
                    },
                    onClick = {
                        menuOpen = false
                        onUnpair()
                    },
                )
            }
        }
    }
}

@Composable
private fun SmsLogCard(
    entry: SmsLogEntry,
    expanded: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = AppSurface,
        border = BorderStroke(1.dp, AppSurfaceVariant),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .animateContentSize(),
    ) {
        Column {
            Row(
                modifier = Modifier.padding(14.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = entry.source,
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = " · ${formatRelativeTime(entry.receivedAtMillis)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = AppSubtleText,
                        )
                    }
                    Spacer(Modifier.height(3.dp))
                    Text(
                        text = entry.maskedSummary,
                        style = MaterialTheme.typography.bodySmall,
                        color = AppMutedText,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.width(8.dp))
                LogStatusChip(status = entry.status)
                if (entry.deliveries.isNotEmpty()) {
                    Spacer(Modifier.width(3.dp))
                    Icon(
                        imageVector =
                            if (expanded) {
                                Icons.Default.KeyboardArrowUp
                            } else {
                                Icons.Default.KeyboardArrowDown
                            },
                        contentDescription = if (expanded) "收起详情" else "展开详情",
                        tint = AppSubtleText,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
            AnimatedVisibility(visible = expanded) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFFF9F9FB))
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    if (entry.deliveries.isEmpty()) {
                        Text(
                            text = entry.detail,
                            style = MaterialTheme.typography.labelMedium,
                            color = AppMutedText,
                        )
                    } else {
                        entry.deliveries.forEach { delivery ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Lock,
                                    contentDescription = null,
                                    tint = AppSubtleText,
                                    modifier = Modifier.size(15.dp),
                                )
                                Spacer(Modifier.width(7.dp))
                                Text(
                                    text = delivery.computerName,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = AppMutedText,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                Text(
                                    text = when (delivery.status) {
                                        SmsDeliveryStatus.SENT -> "发送成功"
                                        SmsDeliveryStatus.SENDING -> delivery.detail
                                        SmsDeliveryStatus.FAILED -> delivery.detail
                                    },
                                    style = MaterialTheme.typography.labelSmall,
                                    color = when (delivery.status) {
                                        SmsDeliveryStatus.SENT -> AppSuccess
                                        SmsDeliveryStatus.SENDING -> AppWarning
                                        SmsDeliveryStatus.FAILED -> AppError
                                    },
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LogStatusChip(status: SmsLogStatus) {
    val label: String
    val foreground: Color
    val background: Color
    when (status) {
        SmsLogStatus.SENDING -> {
            label = "发送中"
            foreground = AppPrimary
            background = AppPrimaryContainer
        }
        SmsLogStatus.SENT -> {
            label = "已发送"
            foreground = AppSuccess
            background = AppSuccessContainer
        }
        SmsLogStatus.PARTIAL -> {
            label = "部分送达"
            foreground = AppWarning
            background = AppWarningContainer
        }
        SmsLogStatus.FAILED -> {
            label = "失败"
            foreground = AppError
            background = AppErrorContainer
        }
        SmsLogStatus.UNRECOGNIZED -> {
            label = "未识别"
            foreground = AppSubtleText
            background = AppSurfaceVariant
        }
    }
    Surface(
        shape = RoundedCornerShape(6.dp),
        color = background,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = foreground,
            modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
        )
    }
}

@Composable
private fun EmptyLogs(onTest: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = AppSurface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 30.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(AppBackground),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Default.Email,
                    contentDescription = null,
                    tint = AppMutedText,
                    modifier = Modifier.size(23.dp),
                )
            }
            Spacer(Modifier.height(12.dp))
            Text(
                text = "暂无短信日志",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "新收到的验证码处理结果\n会显示在这里",
                style = MaterialTheme.typography.bodySmall,
                color = AppSubtleText,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = onTest,
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = AppPrimaryContainer,
                    contentColor = AppPrimary,
                ),
            ) {
                Text("测试同步")
            }
        }
    }
}

@Composable
private fun TestSyncCard(
    sending: Boolean,
    onTest: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = AppSurface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "测试同步",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = "发送一条测试验证码到已配对电脑",
                    style = MaterialTheme.typography.labelMedium,
                    color = AppSubtleText,
                )
            }
            Button(
                onClick = onTest,
                enabled = !sending,
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = AppPrimaryContainer,
                    contentColor = AppPrimary,
                ),
            ) {
                if (sending) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text("测试")
                }
            }
        }
    }
}

@Composable
private fun InactiveContent(
    permissionGranted: Boolean,
    status: String,
    modifier: Modifier = Modifier,
    onRequestPermission: () -> Unit,
    onPair: () -> Unit,
) {
    val remaining = if (permissionGranted) 1 else 2
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(AppSurface)
            .padding(horizontal = 20.dp, vertical = 24.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(AppPrimary),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Default.Email,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(18.dp),
                )
            }
            Spacer(Modifier.width(9.dp))
            Text(
                text = "开启验证码同步",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.height(8.dp))
        Text(
            text = "还需完成 $remaining 项设置",
            style = MaterialTheme.typography.bodyMedium,
            color = AppMutedText,
        )
        Spacer(Modifier.height(12.dp))
        LinearProgressIndicator(
            progress = { if (permissionGranted) 0.5f else 0f },
            modifier = Modifier
                .fillMaxWidth()
                .height(3.dp)
                .clip(CircleShape),
            color = AppPrimary,
            trackColor = AppSurfaceVariant,
        )
        Spacer(Modifier.height(28.dp))
        SetupCard(
            step = 1,
            title = "短信权限",
            note = if (permissionGranted) "已允许接收新短信" else "仅处理新收到的验证码",
            completed = permissionGranted,
            action = if (permissionGranted) null else "允许",
            onAction = onRequestPermission,
        )
        Spacer(Modifier.height(12.dp))
        SetupCard(
            step = 2,
            title = "电脑设备",
            note = "扫描电脑端二维码完成配对",
            completed = false,
            action = "配对",
            onAction = onPair,
        )
        if (status != "尚未配对") {
            Text(
                text = status,
                style = MaterialTheme.typography.bodySmall,
                color = AppError,
                modifier = Modifier.padding(top = 12.dp, start = 4.dp),
            )
        }
        Spacer(Modifier.height(24.dp))
        PrivacyCard()
    }
}

@Composable
private fun SetupCard(
    step: Int,
    title: String,
    note: String,
    completed: Boolean,
    action: String?,
    onAction: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = if (completed) Color(0xFFF4FDF7) else AppSurface,
        border = BorderStroke(
            1.5.dp,
            if (completed) AppSuccessContainer else AppSurfaceVariant,
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .clip(CircleShape)
                    .background(if (completed) AppSuccess else AppSurfaceVariant),
                contentAlignment = Alignment.Center,
            ) {
                if (completed) {
                    Icon(
                        imageVector = Icons.Default.CheckCircle,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(17.dp),
                    )
                } else {
                    Text(
                        text = step.toString(),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = AppMutedText,
                    )
                }
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = note,
                    style = MaterialTheme.typography.bodySmall,
                    color = AppMutedText,
                )
            }
            if (action != null) {
                Spacer(Modifier.width(8.dp))
                Button(
                    onClick = onAction,
                    shape = CircleShape,
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(
                        horizontal = 16.dp,
                        vertical = 8.dp,
                    ),
                ) {
                    Text(action)
                }
            }
        }
    }
}

@Composable
private fun PrivacyCard() {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = AppBackground,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(
                text = "隐私说明",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                color = AppMutedText,
            )
            Spacer(Modifier.height(9.dp))
            PrivacyRow("不读取历史短信")
            Spacer(Modifier.height(8.dp))
            PrivacyRow("普通短信不会上传")
            Spacer(Modifier.height(8.dp))
            PrivacyRow("验证码在本机加密后传输")
        }
    }
}

@Composable
private fun PrivacyRow(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = Icons.Default.Lock,
            contentDescription = null,
            tint = AppSubtleText,
            modifier = Modifier.size(13.dp),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = AppSubtleText,
        )
    }
}

@Composable
private fun PairingWaitingContent(
    status: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(AppSurface),
    ) {
        AppHeader(title = "添加电脑")
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .size(132.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(AppPrimaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Default.Lock,
                    contentDescription = null,
                    tint = AppPrimary,
                    modifier = Modifier.size(62.dp),
                )
            }
            Spacer(Modifier.height(28.dp))
            Text(
                text = "等待电脑端确认配对",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "请回到电脑端确认这台手机。确认完成后，本页面会自动进入同步状态。",
                style = MaterialTheme.typography.bodyMedium,
                color = AppMutedText,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(24.dp))
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = AppBackground,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(22.dp),
                        strokeWidth = 2.dp,
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = status.ifBlank { "等待电脑端确认配对…" },
                        style = MaterialTheme.typography.bodyMedium,
                        color = AppPrimary,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
    }
}

@Composable
private fun PausedContent(
    permissionIssue: Boolean,
    pairedCount: Int,
    modifier: Modifier = Modifier,
    onAction: () -> Unit,
) {
    val bannerBackground = if (permissionIssue) AppErrorContainer else AppWarningContainer
    val bannerForeground = if (permissionIssue) AppError else AppWarning
    val bannerTitle = if (permissionIssue) "同步已暂停" else "需要允许后台运行"
    val bannerNote = if (permissionIssue) "短信权限已关闭" else "系统可能拦截后续短信"
    val actionLabel = if (permissionIssue) "重新开启短信权限" else "允许后台运行"

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(AppSurface),
    ) {
        AppHeader()
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 16.dp),
        ) {
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = bannerBackground,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        modifier = Modifier
                            .size(52.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(AppSurface),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = if (permissionIssue) Icons.Default.Warning else Icons.Default.Lock,
                            contentDescription = null,
                            tint = bannerForeground,
                            modifier = Modifier.size(27.dp),
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(
                        text = bannerTitle,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = bannerNote,
                        style = MaterialTheme.typography.bodyMedium,
                        color = bannerForeground,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
            Spacer(Modifier.height(18.dp))
            if (permissionIssue) {
                InformationCard(
                    label = "影响",
                    lines = listOf(
                        "无法接收和同步新验证码",
                        "已配对的 $pairedCount 台电脑不会丢失",
                    ),
                )
                Spacer(Modifier.height(14.dp))
                InformationCard(
                    label = "下一步",
                    lines = listOf("重新开启短信权限后，将自动继续同步，无需重新配对电脑。"),
                )
            } else {
                InformationCard(
                    label = "原因",
                    lines = listOf("当前系统设置会在屏幕关闭后限制应用运行，导致无法及时收到并同步验证码。"),
                )
                Spacer(Modifier.height(14.dp))
                InformationCard(
                    label = "如何修复",
                    lines = listOf("点击下方按钮，在系统页面中允许本应用在后台持续运行。"),
                )
            }
            Spacer(Modifier.height(28.dp))
            Button(
                onClick = onAction,
                shape = CircleShape,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            ) {
                Text(actionLabel)
            }
        }
    }
}

@Composable
private fun InformationCard(
    label: String,
    lines: List<String>,
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = AppBackground,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = AppMutedText,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(9.dp))
            lines.forEachIndexed { index, line ->
                Row(verticalAlignment = Alignment.Top) {
                    Text(
                        text = "•",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (index == 0) AppError else AppSuccess,
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = line,
                        style = MaterialTheme.typography.bodyMedium,
                        color = AppText,
                        modifier = Modifier.weight(1f),
                    )
                }
                if (index < lines.lastIndex) Spacer(Modifier.height(8.dp))
            }
        }
    }
}

private fun formatRelativeTime(timestampMillis: Long): String {
    val instant = Instant.ofEpochMilli(timestampMillis)
    val age = Duration.between(instant, Instant.now())
    if (!age.isNegative) {
        if (age.toMinutes() < 1) return "刚刚"
        if (age.toMinutes() < 60) return "${age.toMinutes()} 分钟前"
    }
    val dateTime = instant.atZone(ZoneId.systemDefault())
    val prefix = when (dateTime.toLocalDate()) {
        LocalDate.now() -> "今天"
        LocalDate.now().minusDays(1) -> "昨天"
        else -> dateTime.format(DateTimeFormatter.ofPattern("MM-dd"))
    }
    return "$prefix ${dateTime.format(DateTimeFormatter.ofPattern("HH:mm"))}"
}

private fun isBackgroundUnrestricted(context: android.content.Context): Boolean {
    val powerManager = context.getSystemService(PowerManager::class.java)
    return powerManager.isIgnoringBatteryOptimizations(context.packageName)
}
