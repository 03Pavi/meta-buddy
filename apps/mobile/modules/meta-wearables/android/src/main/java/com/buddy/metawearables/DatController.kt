package com.buddy.metawearables

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.meta.wearable.dat.camera.Camera
import com.meta.wearable.dat.camera.Stream
import com.meta.wearable.dat.camera.addCamera
import com.meta.wearable.dat.camera.types.PhotoData
import com.meta.wearable.dat.camera.types.StreamConfiguration
import com.meta.wearable.dat.camera.types.StreamState
import com.meta.wearable.dat.camera.types.VideoQuality
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.AutoDeviceSelector
import com.meta.wearable.dat.core.session.DeviceSession
import com.meta.wearable.dat.core.session.DeviceSessionState
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.PermissionStatus
import com.meta.wearable.dat.core.voiceinvocations.VoiceInvocationsStream
import com.meta.wearable.dat.core.voiceinvocations.startVoiceInvocationsStream
import com.meta.wearable.dat.core.voiceinvocations.types.actions.LaunchApp
import com.meta.wearable.dat.core.voiceinvocations.types.actions.ResponseHandle
import com.meta.wearable.dat.speech.Speech
import com.meta.wearable.dat.speech.SpeechConfiguration
import com.meta.wearable.dat.speech.addSpeech
import com.meta.wearable.dat.speech.types.SpeechState
import java.io.ByteArrayOutputStream
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/**
 * Owns every Meta DAT SDK object and turns SDK flows into JS events.
 *
 * Lifecycle rules followed here (from the DAT docs and AGENTS.md):
 * - Wearables.initialize before anything else.
 * - Registration must reach REGISTERED before a session can start.
 * - Capabilities (camera, speech) are added only after the session reports STARTED.
 * - STOPPED is terminal for a session, so a new session is created for every connect.
 * - Every collector job is cancelled before the capability it observes is removed.
 */
class DatController(
  private val context: Context,
  private val currentActivity: () -> Activity?,
  private val emit: (name: String, payload: Map<String, Any?>) -> Unit,
) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

  private var initialized = false
  private var pendingIntent: Intent? = null
  private var globalJobs = mutableListOf<Job>()

  private var session: DeviceSession? = null
  private var sessionJobs = mutableListOf<Job>()
  private var sawSessionActive = false

  private var stream: Stream? = null
  private var streamJobs = mutableListOf<Job>()
  private var lastFrameEventAtMs = 0L

  private var glassesSpeech: Speech? = null
  private var glassesSpeechOwner: Any? = null
  private var glassesSpeechJobs = mutableListOf<Job>()

  private var invocationStream: VoiceInvocationsStream? = null
  private var invocationJobs = mutableListOf<Job>()
  private val pendingInvocations = HashMap<String, ResponseHandle>()

  val phoneSpeech = PhoneSpeech(
    context,
    emitResult = { text, isFinal ->
      emit(MetaWearablesEvents.SPEECH_RESULT, mapOf("text" to text, "isFinal" to isFinal, "confidence" to -1.0, "source" to "phone"))
    },
    emitError = { message -> emitError("phoneSpeech", message) },
  )

  val speechOutput = SpeechOutput(context) { utteranceId, state, message ->
    emit(MetaWearablesEvents.SPEECH_OUTPUT, mapOf("utteranceId" to utteranceId, "state" to state, "message" to message))
  }

  // region Initialization and snapshot

  fun initialize(promise: Promise) {
    if (initialized) {
      promise.resolve(snapshot().toWritable())
      return
    }
    Wearables.initialize(context)
      .onSuccess {
        initialized = true
        observeGlobal()
        pendingIntent?.let { handleRegistrationIntent(it) }
        pendingIntent = null
        promise.resolve(snapshot().toWritable())
      }
      .onFailure { error, _ -> promise.reject("wearables_init_failed", error.description) }
  }

  private fun observeGlobal() {
    globalJobs += scope.launch {
      Wearables.registrationState.collect { state ->
        emit(MetaWearablesEvents.REGISTRATION_STATE, mapOf("state" to state.name))
      }
    }
    globalJobs += scope.launch {
      // Device connection changes arrive as changes to the set of known devices.
      Wearables.devices.collect { devices ->
        emit(MetaWearablesEvents.DEVICES, mapOf("count" to devices.size, "connected" to devices.isNotEmpty()))
      }
    }
  }

  fun snapshot(): Map<String, Any?> = mapOf(
    "initialized" to initialized,
    "registration" to if (initialized) Wearables.registrationState.value.name else "UNINITIALIZED",
    "deviceCount" to if (initialized) Wearables.devices.value.size else 0,
    "sessionState" to (session?.state?.value?.name ?: "NONE"),
    "cameraState" to (stream?.state?.value?.name ?: "NONE"),
    "glassesSpeechState" to (glassesSpeech?.state?.value?.name ?: "NONE"),
    "voiceInvocationsActive" to (invocationStream != null),
  )

  fun registrationStateName(): String = if (initialized) Wearables.registrationState.value.name else "UNINITIALIZED"

  // endregion

  // region Registration and permissions

  fun startRegistration(promise: Promise) {
    if (!requireInitialized(promise)) return
    val activity = currentActivity()
    if (activity == null) {
      promise.reject("no_activity", "Registration needs a visible screen")
      return
    }
    Wearables.startRegistration(activity)
    promise.resolve(registrationStateName())
  }

  fun startUnregistration(promise: Promise) {
    if (!requireInitialized(promise)) return
    val activity = currentActivity()
    if (activity == null) {
      promise.reject("no_activity", "Unregistration needs a visible screen")
      return
    }
    Wearables.startUnregistration(activity)
    promise.resolve(registrationStateName())
  }

  /** Called from MainActivity.onCreate/onNewIntent through MetaWearablesBridge. */
  fun handleRegistrationIntent(intent: Intent) {
    if (!initialized) {
      // Wearables.handleIntent needs an initialized SDK. Keep the intent and handle it after initialize().
      pendingIntent = intent
      return
    }
    Wearables.handleIntent(intent) { request ->
      // Continue straight away. A confirmation screen can be added here later.
      currentActivity()?.let { request.continueRegistration(it) }
    }.onFailure { error, _ -> emitError("registration", error.description) }
  }

  fun checkPermission(name: String, promise: Promise) {
    if (!requireInitialized(promise)) return
    val permission = permissionFor(name)
    if (permission == null) {
      promise.reject("unknown_permission", "Unknown permission: $name")
      return
    }
    scope.launch {
      Wearables.checkPermissionStatus(permission)
        .onSuccess { status -> promise.resolve(MetaWearablesBridge.permissionStatusName(status)) }
        .onFailure { error, _ -> promise.reject("permission_check_failed", error.description) }
    }
  }

  fun requestPermission(name: String, promise: Promise) {
    if (!requireInitialized(promise)) return
    val permission = permissionFor(name)
    if (permission == null) {
      promise.reject("unknown_permission", "Unknown permission: $name")
      return
    }
    scope.launch {
      val current = Wearables.checkPermissionStatus(permission).getOrDefault(PermissionStatus.Denied)
      if (current == PermissionStatus.Granted) {
        promise.resolve("granted")
        return@launch
      }
      if (!MetaWearablesBridge.requestPermission(permission, promise)) {
        promise.reject("permission_request_busy", "Another permission request is in progress, or the screen is not ready")
      }
    }
  }

  private fun permissionFor(name: String): Permission? = when (name) {
    "camera" -> Permission.CAMERA
    "microphone" -> Permission.MICROPHONE
    else -> null
  }

  // endregion

  // region Session

  /** Creates and starts a session. Resolves once the session reports STARTED. */
  fun connect(promise: Promise) {
    if (!requireInitialized(promise)) return
    if (session?.state?.value == DeviceSessionState.STARTED) {
      promise.resolve(snapshot().toWritable())
      return
    }
    disposeSession()
    Wearables.createSession(AutoDeviceSelector())
      .onSuccess { created -> startSession(created, promise) }
      .onFailure { error, _ -> promise.reject("session_create_failed", error.description) }
  }

  private fun startSession(created: DeviceSession, promise: Promise) {
    session = created
    sawSessionActive = false
    val started = CompletableDeferred<Unit>()

    sessionJobs += scope.launch {
      created.state.collect { state ->
        emit(MetaWearablesEvents.SESSION_STATE, mapOf("state" to state.name))
        when (state) {
          DeviceSessionState.STARTED -> {
            sawSessionActive = true
            if (!started.isCompleted) started.complete(Unit)
          }
          DeviceSessionState.STOPPED -> {
            // The StateFlow's initial value can be STOPPED before start() runs. Only treat it as an end once active.
            if (sawSessionActive) {
              onSessionEnded()
              if (!started.isCompleted) started.completeExceptionally(IllegalStateException("Session stopped before it started"))
            }
          }
          // Any other state after start() means the session is in progress.
          else -> if (state.name != "IDLE") sawSessionActive = true
        }
      }
    }
    sessionJobs += scope.launch {
      created.errors.collect { error -> emitError("session", error.description) }
    }

    created.start()

    scope.launch {
      try {
        withTimeout(SESSION_START_TIMEOUT_MS) { started.await() }
        promise.resolve(snapshot().toWritable())
      } catch (error: Exception) {
        promise.reject("session_start_failed", error.message ?: "Session did not start")
        disposeSession()
      }
    }
  }

  fun disconnect(promise: Promise) {
    stopCameraInternal()
    stopGlassesSpeechInternal()
    phoneSpeech.stop()
    speechOutput.stop()
    session?.stop()
    disposeSession()
    promise.resolve(snapshot().toWritable())
  }

  private fun onSessionEnded() {
    stopCameraInternal()
    stopGlassesSpeechInternal()
    sessionJobs.forEach { it.cancel() }
    sessionJobs.clear()
    session = null
    sawSessionActive = false
  }

  private fun disposeSession() {
    onSessionEnded()
  }

  private fun requireSessionStarted(promise: Promise): DeviceSession? {
    val current = session
    if (current == null || current.state.value != DeviceSessionState.STARTED) {
      promise.reject("session_not_started", "Connect to the glasses before using this feature")
      return null
    }
    return current
  }

  // endregion

  // region Camera

  fun startCamera(options: ReadableMap, promise: Promise) {
    val current = requireSessionStarted(promise) ?: return
    if (stream != null) {
      promise.resolve(snapshot().toWritable())
      return
    }
    val quality = when (options.getString("videoQuality")) {
      "HIGH" -> VideoQuality.HIGH
      "LOW" -> VideoQuality.LOW
      else -> VideoQuality.MEDIUM
    }
    val frameRate = if (options.hasKey("frameRate")) options.getInt("frameRate") else DEFAULT_FRAME_RATE

    scope.launch {
      val permission = Wearables.checkPermissionStatus(Permission.CAMERA).getOrDefault(PermissionStatus.Denied)
      if (permission != PermissionStatus.Granted) {
        promise.reject("camera_permission_denied", "Camera permission has not been granted in the Meta AI app")
        return@launch
      }
      current.addCamera(StreamConfiguration(videoQuality = quality, frameRate = frameRate))
        .onSuccess { camera -> startStream(camera, promise) }
        .onFailure { error, _ -> promise.reject("camera_add_failed", error.description) }
    }
  }

  private fun startStream(camera: Camera, promise: Promise) {
    val newStream = camera.stream
    stream = newStream
    val streaming = CompletableDeferred<Unit>()

    streamJobs += scope.launch {
      newStream.state.collect { state ->
        emit(MetaWearablesEvents.CAMERA_STATE, mapOf("state" to state.name))
        when (state) {
          StreamState.STREAMING -> if (!streaming.isCompleted) streaming.complete(Unit)
          StreamState.STOPPED, StreamState.CLOSED -> {
            if (stream === newStream) stopCameraInternal()
            if (!streaming.isCompleted) streaming.completeExceptionally(IllegalStateException("Camera stopped"))
          }
          else -> Unit
        }
      }
    }
    streamJobs += scope.launch {
      newStream.videoStream.collect { frame ->
        // Frames arrive at up to 30 fps. Report at most once a second so the JS thread stays free.
        val now = System.currentTimeMillis()
        if (now - lastFrameEventAtMs >= FRAME_EVENT_INTERVAL_MS) {
          lastFrameEventAtMs = now
          emit(MetaWearablesEvents.CAMERA_FRAME, mapOf("width" to frame.width, "height" to frame.height, "timestampUs" to frame.presentationTimeUs))
        }
      }
    }
    streamJobs += scope.launch {
      newStream.errorStream.collect { error -> emitError("camera", error.description) }
    }

    newStream.start().onFailure { error, _ -> promise.reject("camera_start_failed", error.description) }

    scope.launch {
      try {
        withTimeout(CAMERA_START_TIMEOUT_MS) { streaming.await() }
        promise.resolve(snapshot().toWritable())
      } catch (error: Exception) {
        promise.reject("camera_start_failed", error.message ?: "Camera did not start")
        stopCameraInternal()
      }
    }
  }

  fun stopCamera(promise: Promise) {
    stopCameraInternal()
    promise.resolve(snapshot().toWritable())
  }

  private fun stopCameraInternal() {
    streamJobs.forEach { it.cancel() }
    streamJobs.clear()
    // Stream.stop releases its resources and detaches it from the session.
    stream?.stop()
    stream = null
  }

  /** Captures a still photo during an active stream and returns it as base64 JPEG. */
  fun capturePhoto(promise: Promise) {
    val active = stream
    if (active == null || active.state.value != StreamState.STREAMING) {
      promise.reject("camera_not_streaming", "Start the camera before capturing a photo")
      return
    }
    scope.launch {
      active.capturePhoto()
        .onSuccess { data ->
          when (data) {
            is PhotoData.Bitmap -> promise.resolve(encodeJpeg(data.bitmap).toWritable())
            is PhotoData.HEIC -> promise.reject("unsupported_photo_format", "HEIC photos are not converted in this build")
          }
        }
        .onFailure { error, _ -> promise.reject("capture_failed", error.description) }
    }
  }

  private fun encodeJpeg(source: Bitmap): Map<String, Any?> {
    val longEdge = maxOf(source.width, source.height)
    val scale = if (longEdge > MAX_IMAGE_EDGE_PX) MAX_IMAGE_EDGE_PX.toFloat() / longEdge else 1f
    val bitmap = if (scale < 1f) {
      Bitmap.createScaledBitmap(source, (source.width * scale).toInt(), (source.height * scale).toInt(), true)
    } else {
      source
    }
    val output = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)
    return mapOf(
      "mimeType" to "image/jpeg",
      "base64" to Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP),
      "width" to bitmap.width,
      "height" to bitmap.height,
    )
  }

  // endregion

  // region Speech (glasses microphone, dev/beta SDK capability)

  /**
   * Starts recognition on the glasses. The Speech capability is dev and beta only in the SDK, and it
   * needs the DAT microphone permission granted from a user action in the Meta AI app.
   */
  fun startGlassesSpeech(promise: Promise) {
    val current = requireSessionStarted(promise) ?: return
    scope.launch {
      val permission = Wearables.checkPermissionStatus(Permission.MICROPHONE).getOrDefault(PermissionStatus.Denied)
      if (permission != PermissionStatus.Granted) {
        promise.reject("microphone_permission_denied", "Microphone permission has not been granted in the Meta AI app")
        return@launch
      }
      // The session keeps its speech capability after stop(), so reuse it instead of adding another.
      val existing = glassesSpeech
      if (existing != null && glassesSpeechOwner === current) {
        startGlassesSpeechOn(existing, promise)
        return@launch
      }
      current.addSpeech(SpeechConfiguration())
        .onSuccess { speech ->
          glassesSpeech = speech
          glassesSpeechOwner = current
          startGlassesSpeechOn(speech, promise)
        }
        .onFailure { error, _ -> promise.reject("speech_add_failed", error.description) }
    }
  }

  private fun startGlassesSpeechOn(speech: Speech, promise: Promise) {
    observeGlassesSpeech(speech)
    speech.start()
      .onSuccess { promise.resolve(snapshot().toWritable()) }
      .onFailure { error, _ -> promise.reject("speech_start_failed", error.description) }
  }

  private fun observeGlassesSpeech(speech: Speech) {
    glassesSpeechJobs += scope.launch {
      speech.state.collect { state ->
        emit(MetaWearablesEvents.SPEECH_STATE, mapOf("state" to state.name, "source" to "glasses"))
      }
    }
    glassesSpeechJobs += scope.launch {
      speech.transcriptions.collect { result ->
        if (result != null) {
          emit(
            MetaWearablesEvents.SPEECH_RESULT,
            mapOf("text" to result.text, "isFinal" to result.isFinal, "confidence" to result.confidence.toDouble(), "source" to "glasses"),
          )
        }
      }
    }
  }

  fun stopGlassesSpeech(promise: Promise) {
    stopGlassesSpeechInternal()
    promise.resolve(snapshot().toWritable())
  }

  private fun stopGlassesSpeechInternal() {
    glassesSpeechJobs.forEach { it.cancel() }
    glassesSpeechJobs.clear()
    glassesSpeech?.stop()
  }

  // endregion

  // region Voice invocations (dev/beta, Wearables-level, not a session capability)

  fun startVoiceInvocations(promise: Promise) {
    if (!requireInitialized(promise)) return
    if (invocationStream != null) {
      promise.resolve(snapshot().toWritable())
      return
    }
    val stream = Wearables.startVoiceInvocationsStream(AutoDeviceSelector(), Dispatchers.Default)
    invocationStream = stream
    invocationJobs += scope.launch {
      stream.invocations.collect { invocation ->
        if (invocation is LaunchApp) {
          val requestId = UUID.randomUUID().toString()
          pendingInvocations[requestId] = invocation.responseHandle
          emit(MetaWearablesEvents.VOICE_INVOCATION, mapOf("requestId" to requestId, "type" to "launch_app"))
          // Every invocation must be answered exactly once. Fail it if the JS layer does not respond in time.
          scope.launch {
            delay(INVOCATION_RESPONSE_TIMEOUT_MS)
            pendingInvocations.remove(requestId)?.sendFailure("timeout")
          }
        }
      }
    }
    invocationJobs += scope.launch {
      stream.state.collect { state -> emit(MetaWearablesEvents.SESSION_STATE, mapOf("state" to "invocations:${state.name}")) }
    }
    invocationJobs += scope.launch {
      stream.errors.collect { error -> emitError("voiceInvocations", error.description) }
    }
    promise.resolve(snapshot().toWritable())
  }

  fun respondToInvocation(requestId: String, success: Boolean, output: String?, promise: Promise) {
    val handle = pendingInvocations.remove(requestId)
    if (handle == null) {
      promise.reject("unknown_invocation", "No pending invocation with this id")
      return
    }
    scope.launch {
      val delivered = if (success) handle.sendSuccess(output) else handle.sendFailure(output)
      promise.resolve(delivered)
    }
  }

  fun stopVoiceInvocations(promise: Promise) {
    stopVoiceInvocationsInternal()
    promise.resolve(snapshot().toWritable())
  }

  private fun stopVoiceInvocationsInternal() {
    // Fail anything still unanswered so the glasses are not left waiting.
    pendingInvocations.values.forEach { handle -> scope.launch { handle.sendFailure("app_stopped") } }
    pendingInvocations.clear()
    invocationJobs.forEach { it.cancel() }
    invocationJobs.clear()
    invocationStream?.close()
    invocationStream = null
  }

  // endregion

  /** Called from the module's invalidate(), when the React context is torn down. */
  fun release() {
    stopCameraInternal()
    stopGlassesSpeechInternal()
    session?.stop()
    disposeSession()
    stopVoiceInvocationsInternal()
    globalJobs.forEach { it.cancel() }
    globalJobs.clear()
    phoneSpeech.destroy()
    speechOutput.shutdown()
    scope.coroutineContext[Job]?.cancel()
  }

  // region helpers

  private fun requireInitialized(promise: Promise): Boolean {
    if (!initialized) {
      promise.reject("not_initialized", "Call initialize() before using the glasses SDK")
      return false
    }
    return true
  }

  private fun emitError(operation: String, message: String) {
    emit(MetaWearablesEvents.ERROR, mapOf("operation" to operation, "message" to message))
  }

  // endregion

  companion object {
    private const val SESSION_START_TIMEOUT_MS = 30_000L
    private const val CAMERA_START_TIMEOUT_MS = 20_000L
    private const val INVOCATION_RESPONSE_TIMEOUT_MS = 10_000L
    private const val FRAME_EVENT_INTERVAL_MS = 1_000L
    private const val DEFAULT_FRAME_RATE = 24
    private const val MAX_IMAGE_EDGE_PX = 1024
    private const val JPEG_QUALITY = 80
  }
}
