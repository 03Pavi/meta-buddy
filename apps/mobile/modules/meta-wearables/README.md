# meta-wearables (native module)

Bridge between the React Native app and Meta's Wearables Device Access Toolkit (DAT) for Android.

- TypeScript API: [`src/index.ts`](src/index.ts). Event mapping: [`src/events.ts`](src/events.ts). Types: [`src/types.ts`](src/types.ts).
- Kotlin implementation: [`android/src/main/java/com/buddy/metawearables/`](android/src/main/java/com/buddy/metawearables/).
  The app's Gradle build adds this folder as a Java/Kotlin source directory, so no npm install is needed.

## Operations and the SDK calls behind them (DAT 1.0.1)

| TypeScript | Native behaviour | SDK call |
| --- | --- | --- |
| `initialize()` | Initialise once at launch | `Wearables.initialize(context)` |
| `startRegistration()` / `startUnregistration()` | Opens the Meta AI registration flow | `Wearables.startRegistration(activity)` / `startUnregistration(activity)` |
| (intent) | Registration callback from Meta AI, cold start included | `Wearables.handleIntent(intent) { request -> request.continueRegistration(activity) }` |
| `checkPermission` / `requestPermission` | `camera`, `microphone` | `Wearables.checkPermissionStatus` and `Wearables.RequestPermissionContract()` |
| `connect()` / `disconnect()` | Creates a session, starts it, waits for `STARTED` (30 s timeout) | `Wearables.createSession(AutoDeviceSelector())`, `session.start()`, `session.stop()` |
| `startCamera()` | Adds the camera only after `STARTED`, then starts the stream | `session.addCamera(StreamConfiguration(...))`, `stream.start()` |
| `capturePhoto()` | Still photo during an active stream, returned as base64 JPEG (long edge capped at 1024 px) | `stream.capturePhoto()` |
| `stopCamera()` | Stops the stream and detaches it | `stream.stop()` |
| `startGlassesSpeech()` / `stopGlassesSpeech()` | Recognition on the glasses. **Dev/beta only.** | `session.addSpeech(SpeechConfiguration())`, `speech.start()`, `speech.stop()` |
| `startPhoneSpeech()` / `stopPhoneSpeech()` | Phone microphone fallback, **only when the user selects it** | `android.speech.SpeechRecognizer` (not DAT) |
| `speak()` / `stopSpeaking()` | Reply audio on the phone. Android routes it to the glasses when they are the active audio device. | `android.speech.tts.TextToSpeech` (not DAT) |
| `startVoiceInvocations()` / `respondToInvocation()` | "Hey Meta, start <app>". **Dev/beta only.** | `Wearables.startVoiceInvocationsStream(...)`, `stream.invocations`, `ResponseHandle.sendSuccess/sendFailure` |

### Events emitted to JS

`MetaWearables.registrationState`, `.devices`, `.sessionState`, `.cameraState`, `.cameraFrame` (at most once a second), `.speechState`, `.speechResult`, `.voiceInvocation`, `.speechOutput`, `.error`.
The JS side maps every payload through `mapNativeEvent`. Malformed payloads are dropped, not thrown.

### Lifecycle rules this module follows

- Nothing touches the SDK before `initialize()` succeeds. An early Meta AI intent is queued and handled afterwards.
- Capabilities are added only after the session reports `STARTED`. Adding one earlier fails with `SESSION_IDLE`.
- The initial `STOPPED` state of a session is ignored until the session has been active. `STOPPED` is terminal, so each `connect()` creates a new session.
- Collector jobs are cancelled before the capability they observe is stopped.
- Every `SDK` call runs on the main thread. Voice invocations are answered exactly once: either by the JS layer or by an automatic failure after 10 seconds.
- Requests for the camera or microphone permission are serialised. Only one can be in flight.

### Not implemented

- iOS. The Swift side (`Wearables.configure`, `handleUrl`, and the rest) is not written. Local iOS builds need a Mac.
- Standalone `camera.photo` capture (Photo capability). The SDK marks it dev/beta, so the app takes stills from the stream instead.
- Audio streaming, Motion, Inputs, and Display. They are outside the assistant's scope.
- Backend (cloud) text-to-speech. Speech output uses the phone's TTS.
