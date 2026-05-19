import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

import { SavedPlan } from "../types";

interface BackupFile {
  version: 1;
  app: string;
  exportedAt: string;
  plans: SavedPlan[];
}

export const exportBackup = async (plans: SavedPlan[]): Promise<void> => {
  const payload: BackupFile = {
    version: 1,
    app: "Fitgen Peptide Calculator",
    exportedAt: new Date().toISOString(),
    plans,
  };

  const date = new Date().toISOString().slice(0, 10);
  const fileName = `fitgen-backup-${date}.json`;
  const uri = FileSystem.cacheDirectory + fileName;

  await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error("Sharing is not available on this device.");

  await Sharing.shareAsync(uri, {
    mimeType: "application/json",
    dialogTitle: "Save your Fitgen backup",
    UTI: "public.json",
  });
};

export const importBackup = async (): Promise<SavedPlan[] | null> => {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "text/plain", "*/*"],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.length) return null;

  const uri = result.assets[0].uri;
  const raw = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const parsed: BackupFile = JSON.parse(raw);
  if (!parsed?.plans || !Array.isArray(parsed.plans)) {
    throw new Error("Invalid backup file — no plans found.");
  }
  return parsed.plans;
};
