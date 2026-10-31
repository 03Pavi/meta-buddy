package com.buddy.metawearables

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * React Native entry point for the Meta DAT integration.
 *
 * Every method runs on the main thread, because the SDK flows and the controller's state are
 * main-thread only. Events are sent to JS through RCTDeviceEventEmitter and wrapped by NativeEventEmitter.
 */
class MetaWearablesModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val mainHandler = Handler(Looper.getMainLooper())

  private val controller = DatController(
    context = reactContext.applicationContext,
    currentActivity = { reactContext.currentActivity },
    emit = { name, payload -> emitToJs(name, payload) },
  )

  init {
    MetaWearablesBridge.attachIntentHandler { intent -> onMain { controller.handleRegistrationIntent(intent) } }
  }

  override fun getName(): String = "MetaWearables"

  override fun invalidate() {
    mainHandler.post { controller.release() }
    super.invalidate()
  }

  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
  }

  private fun emitToJs(name: String, payload: Map<String, Any?>) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(name, payload.toWritable())
  }

  // Required by NativeEventEmitter.
  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Double) = Unit

  // region Setup and registration

  @ReactMethod
  fun initialize(promise: Promise) = onMain { controller.initialize(promise) }

  @ReactMethod
  fun getSnapshot(promise: Promise) = onMain { promise.resolve(controller.snapshot().toWritable()) }

  @ReactMethod
  fun startRegistration(promise: Promise) = onMain { controller.startRegistration(promise) }

  @ReactMethod
  fun startUnregistration(promise: Promise) = onMain { controller.startUnregistration(promise) }

  /** name: "camera" or "microphone". Resolves "granted" or "denied". */
  @ReactMethod
  fun checkPermission(name: String, promise: Promise) = onMain { controller.checkPermission(name, promise) }

  @ReactMethod
  fun requestPermission(name: String, promise: Promise) = onMain { controller.requestPermission(name, promise) }

  // endregion

  // region Session

  @ReactMethod
  fun connect(promise: Promise) = onMain { controller.connect(promise) }

  @ReactMethod
  fun disconnect(promise: Promise) = onMain { controller.disconnect(promise) }

  // endregion

  // region Camera

  @ReactMethod
  fun startCamera(options: ReadableMap?, promise: Promise) =
    onMain { controller.startCamera(options ?: Arguments.createMap(), promise) }

  @ReactMethod
  fun stopCamera(promise: Promise) = onMain { controller.stopCamera(promise) }

  @ReactMethod
  fun capturePhoto(promise: Promise) = onMain { controller.capturePhoto(promise) }

  // endregion

  // region Speech input

  /** Glasses microphone. Dev and beta SDK capability. */
  @ReactMethod
  fun startGlassesSpeech(promise: Promise) = onMain { controller.startGlassesSpeech(promise) }

  @ReactMethod
  fun stopGlassesSpeech(promise: Promise) = onMain { controller.stopGlassesSpeech(promise) }

  /** Phone microphone fallback. The JS layer must request RECORD_AUDIO first. */
  @ReactMethod
  fun startPhoneSpeech(promise: Promise) = onMain { promise.resolve(controller.phoneSpeech.start()) }

  @ReactMethod
  fun stopPhoneSpeech(promise: Promise) = onMain {
    controller.phoneSpeech.stop()
    promise.resolve(true)
  }

  // endregion

  // region Speech output

  @ReactMethod
  fun speak(text: String, utteranceId: String, promise: Promise) = onMain {
    if (controller.speechOutput.speak(text, utteranceId)) {
      promise.resolve(true)
    } else {
      promise.reject("tts_not_ready", "Text-to-speech is still starting. Try again in a moment.")
    }
  }

  @ReactMethod
  fun stopSpeaking(promise: Promise) = onMain {
    controller.speechOutput.stop()
    promise.resolve(true)
  }

  // endregion

  // region Voice invocations

  @ReactMethod
  fun startVoiceInvocations(promise: Promise) = onMain { controller.startVoiceInvocations(promise) }

  @ReactMethod
  fun stopVoiceInvocations(promise: Promise) = onMain { controller.stopVoiceInvocations(promise) }

  @ReactMethod
  fun respondToInvocation(requestId: String, success: Boolean, output: String?, promise: Promise) =
    onMain { controller.respondToInvocation(requestId, success, output, promise) }

  // endregion
}

/** Converts the controller's plain Kotlin maps into the React Native bridge's map type. */
fun Map<String, Any?>.toWritable(): WritableMap {
  val map = Arguments.createMap()
  for ((key, value) in this) {
    when (value) {
      null -> map.putNull(key)
      is String -> map.putString(key, value)
      is Boolean -> map.putBoolean(key, value)
      is Int -> map.putInt(key, value)
      is Long -> map.putDouble(key, value.toDouble())
      is Float -> map.putDouble(key, value.toDouble())
      is Double -> map.putDouble(key, value)
      else -> map.putString(key, value.toString())
    }
  }
  return map
}
