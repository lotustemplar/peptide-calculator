import { Platform } from "react-native";
import { SavedPlan } from "../types";

interface BackupFile {
  version: 1;
  app: string;
  exportedAt: string;
  plans: SavedPlan[];
}

// ─── Export ───────────────────────────────────────────────────────────────────

export const exportBackup = async (plans: SavedPlan[]): Promise<void> => {
  const payload: BackupFile = {
    version: 1,
    app: "Fitgen Peptide Calculator",
    exportedAt: new Date().toISOString(),
    plans,
  };
  const json = JSON.stringify(payload, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `fitgen-backup-${date}.json`;

  if (Platform.OS === "web") {
    // Browser: create a Blob and trigger a download link
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  // Native: write to cache dir and share
  const { File, Paths } = await import("expo-file-system");
  const Sharing         = await import("expo-sharing");

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error("Sharing is not available on this device.");

  const file = new File(Paths.cache, fileName);
  file.write(json);
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    dialogTitle: "Save your Fitgen backup",
    UTI: "public.json",
  });
};

// ─── Import ───────────────────────────────────────────────────────────────────

export const importBackup = async (): Promise<SavedPlan[] | null> => {
  if (Platform.OS === "web") {
    // Browser: use a hidden <input type="file"> element
    return new Promise((resolve, reject) => {
      const input   = document.createElement("input");
      input.type    = "file";
      input.accept  = ".json,application/json,text/plain";

      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        try {
          const text   = await file.text();
          const parsed: BackupFile = JSON.parse(text);
          if (!parsed?.plans || !Array.isArray(parsed.plans))
            throw new Error("Invalid backup file — no plans found.");
          resolve(parsed.plans);
        } catch (err) {
          reject(err);
        }
      };

      // Cancelled without picking
      input.addEventListener("cancel", () => resolve(null));
      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    });
  }

  // Native: use document picker + expo-file-system
  const DocumentPicker = await import("expo-document-picker");
  const { File }       = await import("expo-file-system");

  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "text/plain", "*/*"],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.length) return null;

  const file   = new File(result.assets[0].uri);
  const raw    = await file.text();
  const parsed: BackupFile = JSON.parse(raw);

  if (!parsed?.plans || !Array.isArray(parsed.plans))
    throw new Error("Invalid backup file — no plans found.");

  return parsed.plans;
};
