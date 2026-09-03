package com.countdown.rtnCalculator

import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.rtncalculator.NativeRTNCalculatorSpec

class RTNCalculatorModule(reactContext: ReactApplicationContext): NativeRTNCalculatorSpec(reactContext) {

    override fun getName(): String {
        return NAME
    }
    override fun add(
        a: Double,
        b: Double,
        promise: Promise?
    ) {
        promise?.resolve(a+b);
    }

    override fun reverseString(str: String?): String? {
        return str?.reversed()
    }

    override fun promisesNumber(promise: Promise?) {
        promise?.resolve("resolved")
    }

    override fun callMeLater(
        successCb: Callback?,
        failureCB: Callback?
    ) {
        successCb?.invoke()
    }

    companion object {
        const val NAME = "RTNCalculator"
    }

}