package com.otprelay.android

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

object AppEvents {
    private val mutableSmsLogsChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val smsLogsChanged = mutableSmsLogsChanged.asSharedFlow()

    fun notifySmsLogsChanged() {
        mutableSmsLogsChanged.tryEmit(Unit)
    }
}
