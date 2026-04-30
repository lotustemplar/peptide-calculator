# Peptide Calculator

A clean Expo-based Android app for:

- calculating peptide reconstitution options
- saving preferred fill plans
- scheduling recurring dose reminders

## Install

```bash
npm install
npx expo install expo-notifications @react-native-async-storage/async-storage @expo/ui
```

## Run locally

```bash
npm run android
```

## Build an APK

```bash
npx eas build -p android --profile preview
```

That `preview` profile is configured to generate an `.apk`, which you can upload to your hosting site for download.

## Notes

- Reminder notifications are scheduled in advance and refreshed whenever the app is reopened.
- The calculator is for planning convenience only. Dosing and reconstitution should always be verified against clinician or pharmacy instructions.
