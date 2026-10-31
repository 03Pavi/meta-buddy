package com.buddy.metawearables

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * Speech output through the phone's TextToSpeech engine. Audio goes to whichever output Android has
 * selected. If the glasses are the active Bluetooth audio device, Android routes it there. The app does
 * not force routing.
 */
class SpeechOutput(
  context: Context,
  private val emit: (utteranceId: String, state: String, message: String?) -> Unit,
) {
  @Volatile
  private var ready = false
  private val tts: TextToSpeech

  init {
    tts = TextToSpeech(context) { status ->
      ready = status == TextToSpeech.SUCCESS
    }
    tts.setOnUtteranceProgressListener(
      object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
          emit(utteranceId ?: "", "started", null)
        }

        override fun onDone(utteranceId: String?) {
          emit(utteranceId ?: "", "done", null)
        }

        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) {
          emit(utteranceId ?: "", "error", "Playback failed")
        }
      },
    )
  }

  /** Returns false when the engine is not ready yet. The caller should report that and retry. */
  fun speak(text: String, utteranceId: String): Boolean {
    if (!ready) return false
    tts.language = Locale.getDefault()
    // QUEUE_FLUSH cancels any utterance still playing, so a new request always wins.
    tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
    return true
  }

  fun stop() {
    tts.stop()
  }

  fun shutdown() {
    tts.stop()
    tts.shutdown()
  }
}
