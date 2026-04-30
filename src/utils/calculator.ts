import { DoseOption } from "../types";

const roundTo = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const clampPositive = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0);

const scoreOption = (drawMl: number, syringeMaxMl: number) => {
  const units = drawMl * 100;
  const distanceToWholeUnit = Math.abs(units - Math.round(units));
  const distanceToFiveUnits = Math.abs(units / 5 - Math.round(units / 5));
  const fillRatio = drawMl / syringeMaxMl;
  const centerPenalty = Math.abs(fillRatio - 0.35);

  return distanceToWholeUnit + distanceToFiveUnits * 0.5 + centerPenalty * 2;
};

export const parsePositiveNumber = (value: string) => clampPositive(Number(value));

export const generateDoseOptions = (
  vialMg: number,
  targetDoseMg: number,
  syringeMaxMl: number,
  maxWaterMl = 3,
) => {
  if (
    !Number.isFinite(vialMg) ||
    !Number.isFinite(targetDoseMg) ||
    !Number.isFinite(syringeMaxMl) ||
    vialMg <= 0 ||
    targetDoseMg <= 0 ||
    syringeMaxMl <= 0 ||
    targetDoseMg > vialMg
  ) {
    return [];
  }

  const options: DoseOption[] = [];

  for (let waterStep = 1; waterStep <= maxWaterMl * 10; waterStep += 1) {
    const waterMl = roundTo(waterStep / 10, 1);
    const concentrationMgPerMl = vialMg / waterMl;
    const drawMl = targetDoseMg / concentrationMgPerMl;

    if (drawMl <= 0 || drawMl > syringeMaxMl) {
      continue;
    }

    const roundedDrawMl = roundTo(drawMl, 3);
    const unitsOnOneMlSyringe = roundTo(drawMl * 100, 1);

    options.push({
      id: `${waterMl.toFixed(1)}-${roundedDrawMl.toFixed(3)}`,
      waterMl,
      concentrationMgPerMl: roundTo(concentrationMgPerMl, 2),
      drawMl: roundedDrawMl,
      unitsOnOneMlSyringe,
      score: scoreOption(drawMl, syringeMaxMl),
    });
  }

  return options
    .sort((a, b) => a.score - b.score || a.drawMl - b.drawMl)
    .slice(0, 8);
};

export const formatMl = (value: number) => `${roundTo(value, 2).toFixed(2)} mL`;

export const formatMg = (value: number) => `${roundTo(value, 2).toFixed(2)} mg`;
