package com.countdown.localNotification

import android.Manifest
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.annotation.RequiresPermission
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import androidx.core.net.toUri

class LocalNotifModule (private val ctx: ReactApplicationContext): ReactContextBaseJavaModule(ctx) {
    override fun getName(): String {
        return APP_NAME
    }

    @RequiresApi(Build.VERSION_CODES.S)
    @RequiresPermission(Manifest.permission.SCHEDULE_EXACT_ALARM)
    @ReactMethod
    fun schedule(title: String, body: String, seconds: Double, url: String?) {
        Log.d("notifnotifnotifnotif = $title and $body", "logging")
        val intent = Intent(ctx, NotifReceiver::class.java).apply {
            putExtra("title", title)
            putExtra("body", body)
            putExtra("url", url)   // deep link opened on tap -> RN Linking 'url' event
        }
        val pi = PendingIntent.getBroadcast(
            ctx, title.hashCode(), intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val alarm = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val at = System.currentTimeMillis() + (seconds * 1000).toLong()
        Log.d("notifnotifnotifnotif 2 = $title and $body", "logging")
//        alarm.canScheduleExactAlarms()
        if (alarm.canScheduleExactAlarms()) {
            Log.d("insie if", "inside")
            alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        } else {
            Log.d("insie if", "outside")
            val intent = Intent(
                Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                "package:${ctx.packageName}".toUri()
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(intent)
        }
    }

    companion object {
        const val APP_NAME = "LocalNotif"
    }

}