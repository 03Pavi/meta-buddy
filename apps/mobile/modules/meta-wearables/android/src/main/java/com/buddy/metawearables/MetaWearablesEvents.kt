package com.buddy.metawearables

/** Event names. Keep in sync with modules/meta-wearables/src/events.ts. */
object MetaWearablesEvents {
  const val REGISTRATION_STATE = "MetaWearables.registrationState"
  const val DEVICES = "MetaWearables.devices"
  const val SESSION_STATE = "MetaWearables.sessionState"
  const val CAMERA_STATE = "MetaWearables.cameraState"
  const val CAMERA_FRAME = "MetaWearables.cameraFrame"
  const val SPEECH_STATE = "MetaWearables.speechState"
  const val SPEECH_RESULT = "MetaWearables.speechResult"
  const val VOICE_INVOCATION = "MetaWearables.voiceInvocation"
  const val SPEECH_OUTPUT = "MetaWearables.speechOutput"
  const val ERROR = "MetaWearables.error"
}
