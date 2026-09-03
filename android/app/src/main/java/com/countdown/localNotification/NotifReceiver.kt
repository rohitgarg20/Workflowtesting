package com.countdown.localNotification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.countdown.MainActivity

public class NotifReceiver: BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val channelId = "reminders"
        val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            mgr.getNotificationChannel(channelId) == null) {
            mgr.createNotificationChannel(
                NotificationChannel(channelId, "Reminders", NotificationManager.IMPORTANCE_HIGH),
            )
        }
        val url = intent.getStringExtra("url")
        // ACTION_VIEW + the deep-link URI is what React Native's Linking reads.
        // FLAG_ACTIVITY_SINGLE_TOP -> a foreground/background app gets onNewIntent,
        // which makes RN emit the 'url' event that linking.subscribe listens for.
        val clickIntent = Intent(ctx, MainActivity::class.java).apply {
            action = Intent.ACTION_VIEW
            if (url != null) data = Uri.parse(url)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val clickPendingIntent = PendingIntent.getActivity(
            ctx,
            url.hashCode(),   // unique per deep link so extras aren't reused
            clickIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or
                    PendingIntent.FLAG_IMMUTABLE
        )
        val notif = NotificationCompat.Builder(ctx, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(intent.getStringExtra("title"))
            .setContentIntent(clickPendingIntent)
            .setContentText(intent.getStringExtra("body"))
            .setAutoCancel(true)
            .build()
        Log.d("notifnotifnotifnotif = ${notif}", "logging")
        mgr.notify(System.currentTimeMillis().toInt(), notif)

    }

}