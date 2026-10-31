package com.buddy

import android.content.Intent // @pavi-plugin
import com.meta.wearable.dat.core.Wearables // @pavi-plugin
import com.buddy.metawearables.MetaWearablesBridge // @pavi-plugin

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  // Permission requests must go through a launcher registered before the activity starts (DAT requirement).
  private val permissionLauncher =
    registerForActivityResult(Wearables.RequestPermissionContract()) { result ->
      result
        .onSuccess { status -> MetaWearablesBridge.onPermissionResult(status, null) }
        .onFailure { error, _ -> MetaWearablesBridge.onPermissionResult(null, error.description) }
    } // @pavi-plugin

  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
    MetaWearablesBridge.permissionLauncher = permissionLauncher // @pavi-plugin
    MetaWearablesBridge.onIntent(intent) // @pavi-plugin
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun onNewIntent(intent: Intent) { // @pavi-plugin
    super.onNewIntent(intent)
    MetaWearablesBridge.onIntent(intent)
  }

  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
