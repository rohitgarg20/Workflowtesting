package com.countdown.rtnCalculator

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class RTNCalcularPackage : BaseReactPackage() {
    override fun getModule(
        name: String,
        reactContext: ReactApplicationContext
    ): NativeModule? {
        return if (name == RTNCalculatorModule.NAME) {
            RTNCalculatorModule(reactContext)
        } else {
            null
        }
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                RTNCalculatorModule.NAME to ReactModuleInfo(
                    RTNCalculatorModule.NAME,
                    RTNCalculatorModule.NAME,
                    false,
                    false,
                    false,
                    true
                )
            )
        }
    }

}