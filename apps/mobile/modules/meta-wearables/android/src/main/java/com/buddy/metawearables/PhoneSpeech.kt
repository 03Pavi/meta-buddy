package com.buddy.metawearables

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * FALLBACK speech input using the phone's own recognizer (android.speech.SpeechRecognizer).
 * It hears through the phone microphone, not the glasses. The JS layer must select it explicitly.
 * Requires RECORD_AUDIO, which the JS layer requests before calling start().
 */
class PhoneSpeech(
  private val context: Context,
  private val emitResult: (text: String, isFinal: Boolean) -> Unit,
  private val emitError: (message: String) -> Unit,
) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null

  fun start(): Boolean {
    if (!SpeechRecognizer.isRecognitionAvailable(context)) {
      emitError("Phone speech recognition is not available on this device")
      return false
    }
    mainHandler.post {
      val active = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also { recognizer = it }
      active.setRecognitionListener(listener)
      active.startListening(
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        },
      )
    }
    return true
  }

  fun stop() {
    mainHandler.post { recognizer?.stopListening() }
  }

  fun destroy() {
    mainHandler.post {
      recognizer?.destroy()
      recognizer = null
    }
  }

  private val listener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) = Unit
    override fun onBeginningOfSpeech() = Unit
    override fun onRmsChanged(rmsdB: Float) = Unit
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() = Unit
    override fun onEvent(eventType: Int, params: Bundle?) = Unit

    override fun onPartialResults(partialResults: Bundle?) {
      val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
      emitResult(text, false)
    }

    override fun onResults(results: Bundle?) {
      val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
      emitResult(text, true)
    }

    override fun onError(error: Int) {
      // NO_MATCH and SPEECH_TIMEOUT are normal ends of an utterance, not failures.
      if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) return
      emitError("Phone speech recognition error $error")
    }
  }
}
