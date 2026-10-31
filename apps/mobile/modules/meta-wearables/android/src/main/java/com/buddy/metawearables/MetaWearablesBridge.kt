package com.buddy.metawearables

import android.content.Intent
import androidx.activity.result.ActivityResultLauncher
import com.facebook.react.bridge.Promise
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.PermissionStatus

/**
 * Hand-off point between MainActivity (which owns the Activity Result launchers the SDK requires)
 * and the React Native module. Only one permission request can be in flight at a time.
 */
object MetaWearablesBridge {
  @Volatile
  var permissionLauncher: ActivityResultLauncher<Permission>? = null

  /** Set by the module once the controller exists. Called on the main thread. */
  @Volatile
  var intentHandler: ((Intent) -> Unit)? = null

  // Cold start: Meta AI can launch the app before React Native has created the module.
  private var pendingIntent: Intent? = null

  private var pendingPermission: Promise? = null

  /** MainActivity forwards every onCreate/onNewIntent here. Unrelated intents are ignored by the handler. */
  @Synchronized
  fun onIntent(intent: Intent) {
    val handler = intentHandler
    if (handler == null) {
      pendingIntent = intent
    } else {
      handler(intent)
    }
  }

  @Synchronized
  fun attachIntentHandler(handler: (Intent) -> Unit) {
    intentHandler = handler
    pendingIntent?.let { handler(it) }
    pendingIntent = null
  }

  @Synchronized
  fun requestPermission(permission: Permission, promise: Promise): Boolean {
    val launcher = permissionLauncher ?: return false
    if (pendingPermission != null) return false
    pendingPermission = promise
    launcher.launch(permission)
    return true
  }

  @Synchronized
  fun onPermissionResult(status: PermissionStatus?, errorDescription: String?) {
    val promise = pendingPermission ?: return
    pendingPermission = null
    if (status != null) {
      promise.resolve(permissionStatusName(status))
    } else {
      promise.reject("permission_request_failed", errorDescription ?: "Permission request failed")
    }
  }

  fun permissionStatusName(status: PermissionStatus): String =
    if (status == PermissionStatus.Granted) "granted" else "denied"
}
