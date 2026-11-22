# Android app builder

Open **More → Android** in the desktop rail. Pin Android to keep it visible. This section creates and edits native Android projects with a local Host coding agent, displays real Android emulators on an interactive canvas, and runs Gradle builds and tests.

## Set up this computer

1. Install Android Studio, Android SDK Platform Tools, Android Emulator, the project's SDK platform/build tools, and a JDK compatible with its Android Gradle plugin.
2. Set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) to the SDK directory and restart Locus. The usual Linux, macOS and Windows Android Studio SDK locations are also detected. Java must be on `PATH`.
3. In Android Studio → **Device Manager**, create virtual devices with the screen sizes and Android versions you want to test. Phone, tablet and foldable AVDs appear by their saved names. Download the system images and enable the host virtualization support they require.
4. Configure an AI provider and model in Locus Settings.

## Create or open an app

Choose **New / Open project**, enter an existing absolute folder on this computer (or pick one with **Browse…**), and describe the app or changes. For a new app, use an empty folder as the project root. For an existing app, select either the Gradle root containing `settings.gradle` or `settings.gradle.kts` and the Gradle wrapper, or a React Native / Expo project root (`package.json` depending on `react-native` or `expo`) whose Gradle project lives in `android/`.

Pick **New Kotlin / Compose app** or **New React Native app**. The coding agent uses Kotlin and Jetpack Compose for new native projects, TypeScript with a buildable `android/` folder for new React Native projects (Expo projects run `npx expo prebuild --platform android`), and preserves existing project conventions. The workbench shows the detected project type and prefills the application ID from `app/build.gradle(.kts)`. Chat stays beside the device canvas so you can request changes and review agent approvals. Only open trusted projects: agents and Gradle scripts execute on the Host. Android workflows are local-only and require Host agents to be permitted by organizational policy. Projects remain available in the Android sidebar and project selector after restarting Locus.

## Run and explore

Select an installed AVD and choose **Start device**. Locus starts it without a separate emulator window. The first boot can take several minutes; refresh devices if necessary. Select its `emulator-…` entry under **Connected device**. Existing running emulators also appear; physical phones are excluded.

Enter the app's `applicationId`, such as `com.example.myapp`, and choose **Build & run**. Locus assembles the debug APK, installs it on that emulator and launches its launcher activity. For React Native projects it also starts Metro on port 8081 in the project root (`npx react-native start`, or `npx expo start` for Expo) unless something already listens there, and runs `adb reverse tcp:8081 tcp:8081` so the debug build can load its JavaScript. **Stop Metro** stops a bundler Locus started. Node.js must be on `PATH`, and dependencies must be installed. The canvas shows actual ADB screenshots at roughly one frame per second. Tap to interact, drag to swipe, use Back/Home/Recent apps, rotate, zoom or open fullscreen. Send text to the focused Android field using the text input. Text currently supports Latin letters, numbers, spaces and basic punctuation.

Change devices to check another screen size or Android version. Rotation changes the device's Android orientation setting; apps may lock their own orientation. Pause stops screen capture and canvas input. Emulators continue running when you switch projects or leave the section; use **Stop device** or Android Studio Device Manager when finished. Startup failures appear under Android setup.

## Tests and APKs

| Control | Operation |
| --- | --- |
| Unit tests | `:app:testDebugUnitTest` |
| Device tests | `:app:connectedDebugAndroidTest` against the selected emulator |
| Lint | `:app:lintDebug` |
| Build APK | `:app:assembleDebug` |
| Build & run | Assemble, ADB install, then launch the supplied application ID |

Build & test output shows running/succeeded/failed state and the last 100 KB of process output. Jobs time out after ten minutes, with one active Gradle operation per canonical project folder. The latest jobs are held in memory and cleared when the server restarts. A successful build enables **Download debug APK**.

The initial integration expects a standard `app` module and `app/build/outputs/apk/debug/app-debug.apk` (under `android/` for React Native). Gradle tasks run from the Gradle project directory; JavaScript tests (Jest) run through the coding agent. Custom modules, flavors, split APKs, release bundles and signing need project-specific commands through the coding agent or Android Studio. Missing SDKs, AVDs, Java, wrappers and Gradle failures are surfaced as setup items or errors; the canvas does not simulate a successful native build.

This is a device canvas for a native or React Native app built through code and agent chat. It does not yet include a drag-and-drop Compose layout editor, emulator provisioning, video-rate streaming, Logcat, device sensor controls or Play Store publishing. It is separate from `apps/android`, the Locus phone remote client.
