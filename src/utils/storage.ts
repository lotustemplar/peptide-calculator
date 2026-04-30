import AsyncStorage from "@react-native-async-storage/async-storage";

import { SavedPlan } from "../types";

const STORAGE_KEY = "peptide-calculator:saved-plans";

export const loadPlans = async (): Promise<SavedPlan[]> => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as SavedPlan[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const savePlans = async (plans: SavedPlan[]) => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
};
