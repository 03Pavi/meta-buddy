/**
 * Expo config plugin for the Pavi Android app.
 *
 * `expo prebuild` regenerates the android/ folder, so the native changes live here instead of being edited by hand:
 * - Meta Wearables DAT SDK dependencies, credentials placeholders, and the local Kotlin module source set
 * - the local MetaWearablesPackage registration in MainApplication
 * - the permission launcher and registration/invocation intent hand-off in MainActivity
 * - ABI filter matching the native libraries shipped by llama.rn
 * - release signing from Gradle properties (no keystore or password is committed)
 *
 * Every edit is idempotent, so running prebuild again does not duplicate anything.
 */
const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
  withMainActivity,
  withProjectBuildGradle,
} = require('@expo/config-plugins');

const MWDAT_VERSION = '1.0.1';
const MODULE_SOURCE_DIR = '${rootProject.projectDir}/../modules/meta-wearables/android/src/main/java';
const MARK = '// @pavi-plugin';
const PACKAGE_LINE = 'package com.buddy\n';

function insertAfter(source, anchor, text) {
  const index = source.indexOf(anchor);
  if (index === -1) throw new Error(`withPaviAndroid: anchor not found: ${anchor.trim()}`);
  return source.slice(0, index + anchor.length) + text + source.slice(index + anchor.length);
}

const withMwdatGradleProperties = config =>
  withGradleProperties(config, cfg => {
    const set = (key, value) => {
      const existing = cfg.modResults.find(item => item.type === 'property' && item.key === key);
      if (existing) {
        existing.value = value;
      } else {
        cfg.modResults.push({ type: 'property', key, value });
      }
    };
    set('mwdatVersion', MWDAT_VERSION);
    // 🔧 FIX: Only arm64-v8a. The physical phone connected over USB is arm64-v8a.
    // The old value "arm64-v8a,x86_64" built BOTH architectures on every prebuild,
    // doubling CMake compile time AND peak memory, which was killing the Gradle
    // daemon ("Gradle build daemon has been stopped: stop command received") during
    // expo-modules-core / llama.rn / react-native-screens native builds.
    // If you later need an emulator, add ",x86_64" back OR override on the CLI:
    //   npx expo run:android -- -PreactNativeArchitectures=x86_64
    set('reactNativeArchitectures', 'arm64-v8a');
    return cfg;
  });

const withMwdatAppBuildGradle = config =>
  withAppBuildGradle(config, cfg => {
    let contents = cfg.modResults.contents;
    // Check this edit's own content. The shared marker is also used by the signing edit, which runs first.
    if (contents.includes('mwdat-core')) return cfg;

    // 🔧 FIX: manifestPlaceholders += [...] → putAll([...]) + project.findProperty(...)
    // `+=` on a Map inside the nested `defaultConfig { }` closure builds a NEW map
    // and assigns it back, which the manifest merger sometimes does not see. That
    // was causing:
    //   "Attribute meta-data#com.meta.wearable.mwdat.APPLICATION_ID@value at
    //    AndroidManifest.xml:18:70-109 requires a placeholder substitution but
    //    no value for <mwdat_application_id> is provided."
    // putAll() mutates the live ManifestPlaceholders object Gradle actually reads.
    contents = insertAfter(
      contents,
      'defaultConfig {',
      `\n        ${MARK}\n        // Read from environment variables at build time, so the values are never written to a project file.\n        manifestPlaceholders.putAll([\n            mwdat_application_id: System.getenv('MWDAT_APPLICATION_ID') ?: '0',\n            mwdat_client_token: System.getenv('MWDAT_CLIENT_TOKEN') ?: '0',\n        ])`,
    );
    contents = insertAfter(contents, '\nandroid {', `\n    sourceSets { main { java.srcDirs += ["${MODULE_SOURCE_DIR}"] } }`);
    contents = insertAfter(
      contents,
      '\ndependencies {',
      [
        '',
        '    // Meta Wearables DAT SDK (Maven Central) for the glasses bridge.',
        '    implementation("com.meta.wearable:mwdat-core:$mwdatVersion")',
        '    implementation("com.meta.wearable:mwdat-camera:$mwdatVersion")',
        '    implementation("com.meta.wearable:mwdat-speech:$mwdatVersion")',
        '    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")',
        '    implementation("androidx.activity:activity-ktx:1.10.1")',
      ].join('\n'),
    );
    // 🔧 FIX: Expanded the legacy support-library exclusion.
    // `@react-native-voice/voice` (and `react-native-tts`) still ship build.gradle
    // files depending on com.android.support:appcompat-v7:28.0.0, which drags in
    // com.android.support:support-compat:28.0.0 and support/versionedparcelable,
    // producing:
    //   "Duplicate class android.support.v4.app.INotificationSideChannel found in
    //    modules core-1.17.0.aar -> core-1.17.0-runtime (androidx.core:core:1.17.0)
    //    and support-compat-28.0.0.aar -> support-compat-28.0.0-runtime."
    // The exclude below removes every legacy artifact; the resolutionStrategy with
    // eachDependency substitutes any remaining straggler with its AndroidX
    // equivalent. This block MUST be at the top level of app/build.gradle
    // (outside the android{} block), otherwise it does not apply to
    // debugRuntimeClasspath, which is what checkDebugDuplicateClasses inspects.
    contents += `
${MARK} support-exclude
configurations.all {
    exclude group: 'com.android.support'
    exclude group: 'com.android.support', module: 'support-compat'
    exclude group: 'com.android.support', module: 'versionedparcelable'
    exclude group: 'com.android.support', module: 'support-v4'
    exclude group: 'com.android.support', module: 'appcompat-v7'
    exclude group: 'com.android.support', module: 'support-core-utils'
    exclude group: 'com.android.support', module: 'support-core-ui'
    exclude group: 'com.android.support', module: 'support-fragment'
    exclude group: 'com.android.support', module: 'support-annotations'

    resolutionStrategy {
        force 'androidx.core:core:1.17.0'
        force 'androidx.versionedparcelable:versionedparcelable:1.1.1'
        eachDependency { details ->
            if (details.requested.group == 'com.android.support') {
                def name = details.requested.name
                if (name == 'support-compat' || name == 'support-v4') {
                    details.useTarget 'androidx.core:core:1.17.0'
                } else if (name == 'versionedparcelable') {
                    details.useTarget 'androidx.versionedparcelable:versionedparcelable:1.1.1'
                } else if (name == 'support-annotations') {
                    details.useTarget 'androidx.annotation:annotation:1.9.0'
                } else if (name == 'appcompat-v7') {
                    details.useTarget 'androidx.appcompat:appcompat:1.7.0'
                }
            }
        }
    }
}
`;
    cfg.modResults.contents = contents;
    return cfg;
  });

/**
 * Release signing. The keystore and passwords come from Gradle properties (never committed):
 *   pavi.uploadStoreFile, pavi.uploadStorePassword, pavi.uploadKeyAlias, pavi.uploadKeyPassword
 * Without them the release build is signed with the debug key, which is fine for local testing only.
 */
const withPaviSigning = config =>
  withAppBuildGradle(config, cfg => {
    let contents = cfg.modResults.contents;
    if (contents.includes('pavi.uploadStoreFile')) return cfg;

    contents = insertAfter(
      contents,
      'signingConfigs {',
      [
        '',
        `        ${MARK}`,
        '        release {',
        "            if (project.hasProperty('pavi.uploadStoreFile')) {",
        "                storeFile file(project.property('pavi.uploadStoreFile'))",
        "                storePassword project.property('pavi.uploadStorePassword')",
        "                keyAlias project.property('pavi.uploadKeyAlias')",
        "                keyPassword project.property('pavi.uploadKeyPassword')",
        '            }',
        '        }',
      ].join('\n'),
    );
    contents = contents.replace(
      /(buildTypes \{[\s\S]*?release \{[\s\S]*?signingConfig )signingConfigs\.debug/,
      "$1(project.hasProperty('pavi.uploadStoreFile') ? signingConfigs.release : signingConfigs.debug)",
    );
    cfg.modResults.contents = contents;
    return cfg;
  });

const withMwdatManifest = config =>
  withAndroidManifest(config, cfg => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      app,
      'com.meta.wearable.mwdat.APPLICATION_ID',
      '${mwdat_application_id}',
    );
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'com.meta.wearable.mwdat.CLIENT_TOKEN', '${mwdat_client_token}');
    return cfg;
  });

/**
 * MainApplication is not a typed mod in this config-plugins version, so the generated file is edited after the
 * template is written.
 */
const withMwdatMainApplication = config =>
  withDangerousMod(config, [
    'android',
    async cfg => {
      const file = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/java/com/buddy/MainApplication.kt');
      let contents = fs.readFileSync(file, 'utf8');
      if (!contents.includes(MARK)) {
        contents = insertAfter(contents, PACKAGE_LINE, `\nimport com.buddy.metawearables.MetaWearablesPackage ${MARK}\n`);
        contents = contents.replace(
          /PackageList\(this\)\.packages\.apply \{/,
          match => `${match}\n          add(MetaWearablesPackage()) ${MARK}`,
        );
        fs.writeFileSync(file, contents);
      }
      return cfg;
    },
  ]);

const withMwdatMainActivity = config =>
  withMainActivity(config, cfg => {
    let contents = cfg.modResults.contents;
    if (contents.includes(MARK)) return cfg;

    contents = insertAfter(
      contents,
      PACKAGE_LINE,
      [
        `\nimport android.content.Intent ${MARK}`,
        `import com.meta.wearable.dat.core.Wearables ${MARK}`,
        `import com.buddy.metawearables.MetaWearablesBridge ${MARK}\n`,
      ].join('\n'),
    );
    contents = insertAfter(
      contents,
      'class MainActivity : ReactActivity() {',
      [
        '',
        '  // Permission requests must go through a launcher registered before the activity starts (DAT requirement).',
        '  private val permissionLauncher =',
        '    registerForActivityResult(Wearables.RequestPermissionContract()) { result ->',
        '      result',
        '        .onSuccess { status -> MetaWearablesBridge.onPermissionResult(status, null) }',
        '        .onFailure { error, _ -> MetaWearablesBridge.onPermissionResult(null, error.description) }',
        `    } ${MARK}`,
        '',
      ].join('\n'),
    );
    contents = insertAfter(
      contents,
      'super.onCreate(null)',
      `\n    MetaWearablesBridge.permissionLauncher = permissionLauncher ${MARK}\n    MetaWearablesBridge.onIntent(intent) ${MARK}`,
    );
    contents = contents.replace(
      /  override fun getMainComponentName/,
      [
        `  override fun onNewIntent(intent: Intent) { ${MARK}`,
        '    super.onNewIntent(intent)',
        '    MetaWearablesBridge.onIntent(intent)',
        '  }',
        '',
        '  override fun getMainComponentName',
      ].join('\n'),
    );
    cfg.modResults.contents = contents;
    return cfg;
  });

/**
 * The SDK's bundled CMake 3.22.1 crashes (ninja access violation) while building expo-modules-core on Windows.
 * Every Android module that builds native code is switched to CMake 3.31.6, which is installed in the SDK.
 */
const CMAKE_VERSION = '3.31.6';
const withPaviCmakeVersion = config =>
  withProjectBuildGradle(config, cfg => {
    if (cfg.modResults.contents.includes(MARK + ' cmake')) return cfg;
    cfg.modResults.contents += [
      '',
      `// ${MARK} cmake`,
      'subprojects { subproject ->',
      '    def setCmake = {',
      '        try {',
      `            subproject.android.externalNativeBuild.cmake.version = "${CMAKE_VERSION}"`,
      '            // Short build output folder: Windows rejects the long CMake object paths otherwise. Other systems keep the default.',
      '            if (System.getProperty("os.name").toLowerCase().contains("windows")) {',
      '                subproject.android.externalNativeBuild.cmake.buildStagingDirectory = "C:/b"',
      '            }',
      '        } catch (Exception ignored) {',
      '            // Modules without native code have no cmake block.',
      '        }',
      '    }',
      '    if (subproject.state.executed) {',
      '        setCmake()',
      '    } else {',
      '        subproject.afterEvaluate { setCmake() }',
      '    }',
      '}',
      '',
    ].join('\n');
    return cfg;
  });

module.exports = config => {
  config = withMwdatGradleProperties(config);
  config = withPaviCmakeVersion(config);
  config = withMwdatAppBuildGradle(config);
  config = withMwdatManifest(config);
  config = withMwdatMainApplication(config);
  config = withMwdatMainActivity(config);
  config = withPaviSigning(config);
  return config;
};