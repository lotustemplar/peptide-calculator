import AsyncStorage from "@react-native-async-storage/async-storage";

import { SavedPlan } from "../types";

const STORAGE_KEY = "peptide-calculator:saved-plans";
const TAKEN_KEY   = "peptide-calculator:taken-doses";

export const loadPlans = async (): Promise<SavedPlan[]> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SavedPlan[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

export const savePlans = async (plans: SavedPlan[]) => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
};

/** Record<"planId|YYYY-MM-DD", true> — which dose days the user has marked taken */
export const loadTakenDoses = async (): Promise<Record<string, true>> => {
  const raw = await AsyncStorage.getItem(TAKEN_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) ?? {}; } catch { return {}; }
};

export const saveTakenDoses = async (taken: Record<string, true>) => {
  await AsyncStorage.setItem(TAKEN_KEY, JSON.stringify(taken));
};
