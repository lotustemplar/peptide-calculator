export type DoseOption = {
  id: string;
  waterMl: number;
  concentrationMgPerMl: number;
  drawMl: number;
  unitsOnOneMlSyringe: number;
  score: number;
};

export type SavedPlan = {
  id: string;
  name: string;
  vialMg: number;
  syringeMaxMl: number;
  targetDoseMg: number;
  selectedWaterMl: number;
  selectedDrawMl: number;
  concentrationMgPerMl: number;
  intervalDays: number;
  reminderTimeIso: string;
  reminderEnabled: boolean;
  notificationIds: string[];
  createdAt: string;
};
