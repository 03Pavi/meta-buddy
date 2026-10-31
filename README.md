# Buddy

On-device assistant for Android, built with React Native and Expo. Replies are generated on the phone with a local
model. The app is in `apps/mobile`.

## Build the debug APK

The GitHub Actions workflow `.github/workflows/android-debug-apk.yml` builds a debug APK on every push to `main`.
Download it from the run's **Artifacts** section (`buddy-debug-apk`).

Optional repository secrets for the Meta Wearables app: `MWDAT_APPLICATION_ID` and `MWDAT_CLIENT_TOKEN`. Without them
the build still succeeds, with Developer Mode values.
