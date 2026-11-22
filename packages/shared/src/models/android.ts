/** Native Android development on the local Host. */
export const ANDROID_PLAYBOOK = `LOCUS_ANDROID_WORKFLOW
Build and edit a real Android app in the selected Host workspace. Two layouts are supported:
1. Native: a Gradle project at the workspace root (gradlew, settings.gradle(.kts), app module).
   Use Kotlin and Jetpack Compose for new native projects.
2. React Native / Expo: package.json at the workspace root and the Gradle project in android/
   (android/gradlew, android/app). For a new React Native app scaffold into the selected folder
   (for example npx create-expo-app@latest . then npx expo prebuild --platform android, or the
   React Native community CLI), write TypeScript, and keep the android/ folder buildable.
   Run JavaScript tests with the project's test script (Jest) in addition to Gradle tasks.
The debug APK is app/build/outputs/apk/debug/app-debug.apk inside the Gradle project.
Preserve existing project conventions. Inspect existing files first; for a new app use the
selected folder as the project root and never overwrite existing files.
Add meaningful unit and instrumentation tests. Use the installed Android SDK, JDK and Node.
Run :app:assembleDebug, :app:testDebugUnitTest and :app:lintDebug from the Gradle project;
report actual results and missing prerequisites honestly.
Do not substitute HTML or a WebView mockup for the app. Do not commit SDK paths, keystores,
credentials, build outputs, node_modules or .gradle. The Android workspace can boot existing
AVDs, display their actual screens and install the debug APK; for React Native it starts Metro
on port 8081 and runs adb reverse. Release signing stays manual.`;

export type AndroidProjectKind = "native" | "react-native";
export interface AndroidProjectInfo {
  kind: AndroidProjectKind | null;
  expo: boolean;
  applicationId: string | null;
  /** Metro bundler state for React Native projects; null for native ones. */
  metro: { managed: boolean; log: string } | null;
  /** Why the workspace is not (yet) a buildable Android project. */
  issue: string | null;
}

export type AndroidAction = "build" | "test" | "lint" | "instrument" | "run";
export interface AndroidJob {
  id: string;
  action: AndroidAction;
  status: "running" | "succeeded" | "failed";
  log: string;
  startedAt: string;
  finishedAt?: string;
}
export interface AndroidEnvironment {
  sdk: string | null;
  avds: string[];
  devices: { serial: string; state: string }[];
  issues: string[];
}
