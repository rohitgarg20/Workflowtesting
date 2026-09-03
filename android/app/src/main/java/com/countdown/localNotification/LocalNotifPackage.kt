package com.countdown.localNotification

import com.countdown.localNotification.LocalNotifModule.Companion.APP_NAME
import com.facebook.react.BaseReactPackage
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class LocalNotifPackage: BaseReactPackage() {

    override fun getModule(name: String, ctx: ReactApplicationContext): NativeModule? =
        if (name == APP_NAME) LocalNotifModule(ctx) else null

    // tell the runtime what this package provides
    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(
            APP_NAME to ReactModuleInfo(
                APP_NAME,   // name
                "LocalNotifModule",   // className
                false,          // canOverrideExistingModule
                false,          // needsEagerInit
                false,          // isCxxModule
                false,          // isTurboModule (classic bridge module via interop)
            ),
        )
    }

}