import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import DateTimePicker from "@expo/ui/datetimepicker";

import { SavedPlan } from "./src/types";
import { formatMg, formatMl, generateDoseOptions, parsePositiveNumber } from "./src/utils/calculator";
import {
  cancelReminderSeriesAsync,
  refreshActiveReminderWindowsAsync,
  requestReminderPermissionsAsync,
  scheduleReminderSeriesAsync,
} from "./src/utils/notifications";
import { loadPlans, savePlans } from "./src/utils/storage";

const createPlanId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const promoMessage = {
  eyebrow: "Featured peptide",
  title: "Promote a vial, bundle, or limited drop here.",
  body: "This bottom slot is reserved for your sales message, pricing, or a direct download-to-store campaign.",
  cta: "Shop now",
};

const defaultReminderTime = () => {
  const date = new Date();
  date.setHours(8, 0, 0, 0);
  return date;
};

const formatTimeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

export default function App() {
  const [vialMg, setVialMg] = useState("10");
  const [syringeMaxMl, setSyringeMaxMl] = useState("1");
  const [targetDoseMg, setTargetDoseMg] = useState("2");
  const [selectedOptionId, setSelectedOptionId] = useState("");

  const [planName, setPlanName] = useState("");
  const [intervalDays, setIntervalDays] = useState("3");
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderTime, setReminderTime] = useState(defaultReminderTime);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const parsedVialMg = parsePositiveNumber(vialMg);
  const parsedSyringeMaxMl = parsePositiveNumber(syringeMaxMl);
  const parsedTargetDoseMg = parsePositiveNumber(targetDoseMg);
  const parsedIntervalDays = Math.max(1, Math.round(parsePositiveNumber(intervalDays)));

  const options = useMemo(
    () => generateDoseOptions(parsedVialMg, parsedTargetDoseMg, parsedSyringeMaxMl),
    [parsedSyringeMaxMl, parsedTargetDoseMg, parsedVialMg],
  );

  const selectedOption = options.find((option) => option.id === selectedOptionId) ?? options[0] ?? null;

  useEffect(() => {
    if (!selectedOption) {
      setSelectedOptionId("");
      return;
    }

    if (selectedOption.id !== selectedOptionId) {
      setSelectedOptionId(selectedOption.id);
    }
  }, [selectedOption, selectedOptionId]);

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      const storedPlans = await loadPlans();
      let hydratedPlans = storedPlans;

      try {
        hydratedPlans = await refreshActiveReminderWindowsAsync(storedPlans);
        await savePlans(hydratedPlans);
      } catch {
        hydratedPlans = storedPlans;
      }

      if (!isMounted) {
        return;
      }

      setPlans(hydratedPlans);
      setIsBootstrapping(false);
    };

    bootstrap().catch(() => {
      if (isMounted) {
        setIsBootstrapping(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const persistPlans = async (nextPlans: SavedPlan[]) => {
    setPlans(nextPlans);
    await savePlans(nextPlans);
  };

  const resetSaveFields = () => {
    setPlanName("");
    setReminderEnabled(true);
    setIntervalDays("3");
    setReminderTime(defaultReminderTime());
  };

  const handleSavePlan = async () => {
    if (!selectedOption) {
      Alert.alert(
        "No valid options yet",
        "Try changing the vial amount, target dose, or syringe size until a dose option appears.",
      );
      return;
    }

    if (!parsedVialMg || !parsedSyringeMaxMl || !parsedTargetDoseMg) {
      Alert.alert("Missing details", "Enter the vial amount, syringe max, and target dose first.");
      return;
    }

    if (parsedTargetDoseMg > parsedVialMg) {
      Alert.alert("Dose is too high", "The requested dose cannot be larger than the total milligrams in the vial.");
      return;
    }

    setIsSaving(true);

    try {
      const nextPlan: SavedPlan = {
        id: createPlanId(),
        name: planName.trim() || `${formatMg(parsedTargetDoseMg)} plan`,
        vialMg: parsedVialMg,
        syringeMaxMl: parsedSyringeMaxMl,
        targetDoseMg: parsedTargetDoseMg,
        selectedWaterMl: selectedOption.waterMl,
        selectedDrawMl: selectedOption.drawMl,
        concentrationMgPerMl: selectedOption.concentrationMgPerMl,
        intervalDays: parsedIntervalDays,
        reminderTimeIso: reminderTime.toISOString(),
        reminderEnabled,
        notificationIds: [],
        createdAt: new Date().toISOString(),
      };

      if (reminderEnabled) {
        const allowed = await requestReminderPermissionsAsync();

        if (!allowed) {
          Alert.alert("Notifications are off", "The fill plan was saved, but reminders were not enabled.");
          nextPlan.reminderEnabled = false;
        } else {
          nextPlan.notificationIds = await scheduleReminderSeriesAsync(nextPlan);
        }
      }

      const nextPlans = [nextPlan, ...plans];
      await persistPlans(nextPlans);
      resetSaveFields();

      Alert.alert("Saved", "Your fill plan is ready and can be reopened from the saved plans section.");
    } finally {
      setIsSaving(false);
    }
  };

  const loadPlanIntoCalculator = (plan: SavedPlan) => {
    setVialMg(String(plan.vialMg));
    setSyringeMaxMl(String(plan.syringeMaxMl));
    setTargetDoseMg(String(plan.targetDoseMg));
    setPlanName(plan.name);
    setIntervalDays(String(plan.intervalDays));
    setReminderEnabled(plan.reminderEnabled);
    setReminderTime(new Date(plan.reminderTimeIso));
    setSelectedOptionId(`${plan.selectedWaterMl.toFixed(1)}-${plan.selectedDrawMl.toFixed(3)}`);
  };

  const toggleReminder = async (plan: SavedPlan) => {
    const updatedPlans = [...plans];
    const index = updatedPlans.findIndex((item) => item.id === plan.id);

    if (index < 0) {
      return;
    }

    const current = updatedPlans[index];

    if (current.reminderEnabled) {
      await cancelReminderSeriesAsync(current.notificationIds);
      updatedPlans[index] = {
        ...current,
        reminderEnabled: false,
        notificationIds: [],
      };
      await persistPlans(updatedPlans);
      return;
    }

    const allowed = await requestReminderPermissionsAsync();

    if (!allowed) {
      Alert.alert("Notifications are off", "Enable notifications on the device to turn this reminder back on.");
      return;
    }

    const enabledPlan: SavedPlan = {
      ...current,
      reminderEnabled: true,
    };

    enabledPlan.notificationIds = await scheduleReminderSeriesAsync(enabledPlan);
    updatedPlans[index] = enabledPlan;
    await persistPlans(updatedPlans);
  };

  const deletePlan = async (plan: SavedPlan) => {
    await cancelReminderSeriesAsync(plan.notificationIds);
    const nextPlans = plans.filter((item) => item.id !== plan.id);
    await persistPlans(nextPlans);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Peptide Calculator</Text>
          </View>
          <Text style={styles.heroTitle}>Simple reconstitution math, clean saved fills, and dose reminders.</Text>
          <Text style={styles.heroSubtitle}>
            Enter the vial strength, choose your syringe limit, and compare easy-to-measure bacteriostatic water options
            up to 3 mL.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Calculator</Text>
          <Text style={styles.cardSubtitle}>
            This app is for planning convenience only. Always verify reconstitution and dosing instructions with your
            clinician or pharmacy.
          </Text>

          <View style={styles.inputGrid}>
            <Field
              label="Milligrams in vial"
              value={vialMg}
              onChangeText={setVialMg}
              placeholder="10"
              suffix="mg"
            />
            <Field
              label="Syringe max"
              value={syringeMaxMl}
              onChangeText={setSyringeMaxMl}
              placeholder="1"
              suffix="mL"
            />
            <Field
              label="Dose needed"
              value={targetDoseMg}
              onChangeText={setTargetDoseMg}
              placeholder="2"
              suffix="mg"
            />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionRow}>
            <Text style={styles.cardTitle}>Dose options</Text>
            <Text style={styles.sectionMeta}>Max water: 3.0 mL</Text>
          </View>

          {selectedOption ? (
            <View style={styles.highlightPanel}>
              <Text style={styles.highlightLabel}>Recommended right now</Text>
              <Text style={styles.highlightValue}>{formatMl(selectedOption.drawMl)} to draw</Text>
              <Text style={styles.highlightBody}>
                Add {formatMl(selectedOption.waterMl)} bacteriostatic water. Concentration becomes{" "}
                {formatMg(selectedOption.concentrationMgPerMl)} per mL.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No valid options yet</Text>
              <Text style={styles.emptyBody}>
                Try a smaller dose or a larger syringe size. The selected draw amount has to fit inside the syringe
                limit.
              </Text>
            </View>
          )}

          {options.map((option, index) => {
            const isSelected = selectedOption?.id === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => setSelectedOptionId(option.id)}
                style={[styles.optionCard, isSelected && styles.optionCardSelected]}
              >
                <View style={styles.optionHeader}>
                  <Text style={styles.optionTag}>{index === 0 ? "Best fit" : `Option ${index + 1}`}</Text>
                  <Text style={styles.optionDraw}>{formatMl(option.drawMl)}</Text>
                </View>
                <Text style={styles.optionText}>Add {formatMl(option.waterMl)} bacteriostatic water.</Text>
                <Text style={styles.optionText}>Draw about {option.unitsOnOneMlSyringe} units on a 1 mL syringe.</Text>
                <Text style={styles.optionText}>Concentration: {formatMg(option.concentrationMgPerMl)} per mL.</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Save this fill</Text>
          <Text style={styles.cardSubtitle}>
            Save your preferred setup, then optionally remind the user to take 1 dose every X days at a chosen time.
          </Text>

          <Field
            label="Plan name"
            value={planName}
            onChangeText={setPlanName}
            placeholder="Morning plan"
            keyboardType="default"
          />

          <View style={styles.inlineRow}>
            <View style={styles.inlineField}>
              <Field
                label="Every X days"
                value={intervalDays}
                onChangeText={setIntervalDays}
                placeholder="3"
                suffix="days"
              />
            </View>

            <View style={styles.timeField}>
              <Text style={styles.fieldLabel}>Reminder time</Text>
              <Pressable onPress={() => setShowTimePicker(true)} style={styles.timeButton}>
                <Text style={styles.timeButtonLabel}>{formatTimeLabel(reminderTime.toISOString())}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.switchRow}>
            <View>
              <Text style={styles.switchTitle}>Enable reminders</Text>
              <Text style={styles.switchSubtitle}>The reminder message includes the exact mL to draw.</Text>
            </View>
            <Switch value={reminderEnabled} onValueChange={setReminderEnabled} trackColor={{ true: "#0f766e" }} />
          </View>

          <Pressable onPress={handleSavePlan} style={styles.primaryButton} disabled={isSaving}>
            <Text style={styles.primaryButtonText}>{isSaving ? "Saving..." : "Save fill plan"}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionRow}>
            <Text style={styles.cardTitle}>Saved plans</Text>
            <Text style={styles.sectionMeta}>{plans.length}</Text>
          </View>

          {isBootstrapping ? (
            <Text style={styles.cardSubtitle}>Loading saved plans...</Text>
          ) : plans.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Nothing saved yet</Text>
              <Text style={styles.emptyBody}>Pick a dose option above, then save it so it can be reused later.</Text>
            </View>
          ) : (
            plans.map((plan) => (
              <View key={plan.id} style={styles.savedCard}>
                <View style={styles.savedHeader}>
                  <View>
                    <Text style={styles.savedTitle}>{plan.name}</Text>
                    <Text style={styles.savedMeta}>
                      {formatMg(plan.targetDoseMg)} dose • {formatMl(plan.selectedDrawMl)} draw
                    </Text>
                  </View>
                  <View style={[styles.savedStatus, plan.reminderEnabled && styles.savedStatusActive]}>
                    <Text style={[styles.savedStatusText, plan.reminderEnabled && styles.savedStatusTextActive]}>
                      {plan.reminderEnabled ? "Reminder on" : "Reminder off"}
                    </Text>
                  </View>
                </View>

                <Text style={styles.savedDetail}>Add {formatMl(plan.selectedWaterMl)} bacteriostatic water.</Text>
                <Text style={styles.savedDetail}>Concentration: {formatMg(plan.concentrationMgPerMl)} per mL.</Text>
                <Text style={styles.savedDetail}>
                  Schedule: every {plan.intervalDays} day{plan.intervalDays === 1 ? "" : "s"} at{" "}
                  {formatTimeLabel(plan.reminderTimeIso)}.
                </Text>

                <View style={styles.savedActions}>
                  <ActionButton label="Use again" onPress={() => loadPlanIntoCalculator(plan)} />
                  <ActionButton
                    label={plan.reminderEnabled ? "Pause reminder" : "Enable reminder"}
                    onPress={() => toggleReminder(plan)}
                  />
                  <ActionButton label="Delete" destructive onPress={() => deletePlan(plan)} />
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.bottomAdSpacer} />
      </ScrollView>

      <View style={styles.bottomAdShell}>
        <View style={styles.bottomAdCard}>
          <Text style={styles.bottomAdEyebrow}>{promoMessage.eyebrow}</Text>
          <Text style={styles.bottomAdTitle}>{promoMessage.title}</Text>
          <Text style={styles.bottomAdBody}>{promoMessage.body}</Text>
          <Pressable style={styles.bottomAdButton}>
            <Text style={styles.bottomAdButtonText}>{promoMessage.cta}</Text>
          </Pressable>
        </View>
      </View>

      {showTimePicker ? (
        <DateTimePicker
          value={reminderTime}
          mode="time"
          presentation="dialog"
          onValueChange={(_, date) => {
            setReminderTime(date);
            setShowTimePicker(false);
          }}
          onDismiss={() => setShowTimePicker(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  suffix?: string;
  keyboardType?: "default" | "decimal-pad";
};

function Field({ label, value, onChangeText, placeholder, suffix, keyboardType = "decimal-pad" }: FieldProps) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputShell}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#94a3b8"
          keyboardType={keyboardType}
        />
        {suffix ? <Text style={styles.inputSuffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

function ActionButton({ label, onPress, destructive = false }: ActionButtonProps) {
  return (
    <Pressable onPress={onPress} style={[styles.actionButton, destructive && styles.actionButtonDestructive]}>
      <Text style={[styles.actionButtonText, destructive && styles.actionButtonTextDestructive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f6f1e8",
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 20,
    gap: 16,
  },
  hero: {
    backgroundColor: "#103f3a",
    borderRadius: 28,
    padding: 22,
    overflow: "hidden",
  },
  heroBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#d2efe7",
    marginBottom: 14,
  },
  heroBadgeText: {
    color: "#103f3a",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  heroTitle: {
    color: "#f8fafc",
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    marginBottom: 10,
  },
  heroSubtitle: {
    color: "#d7e4df",
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    backgroundColor: "#fffdfa",
    borderRadius: 24,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: "#efe4d6",
  },
  cardTitle: {
    color: "#172554",
    fontSize: 20,
    fontWeight: "800",
  },
  cardSubtitle: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
  },
  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionMeta: {
    color: "#0f766e",
    fontWeight: "700",
  },
  inputGrid: {
    gap: 12,
  },
  fieldBlock: {
    gap: 7,
  },
  fieldLabel: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "700",
  },
  inputShell: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#dbe1ea",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  input: {
    flex: 1,
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "600",
  },
  inputSuffix: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "700",
  },
  highlightPanel: {
    backgroundColor: "#f0fdf4",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    gap: 6,
  },
  highlightLabel: {
    color: "#15803d",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  highlightValue: {
    color: "#14532d",
    fontSize: 28,
    fontWeight: "900",
  },
  highlightBody: {
    color: "#166534",
    fontSize: 14,
    lineHeight: 20,
  },
  optionCard: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dbe7f3",
    gap: 6,
  },
  optionCardSelected: {
    backgroundColor: "#eff6ff",
    borderColor: "#60a5fa",
  },
  optionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  optionTag: {
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  optionDraw: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "800",
  },
  optionText: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
  },
  emptyState: {
    borderRadius: 20,
    padding: 16,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#cbd5e1",
    gap: 6,
  },
  emptyTitle: {
    color: "#1e293b",
    fontSize: 16,
    fontWeight: "800",
  },
  emptyBody: {
    color: "#64748b",
    fontSize: 14,
    lineHeight: 20,
  },
  inlineRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-end",
  },
  inlineField: {
    flex: 1,
  },
  timeField: {
    flex: 1,
    gap: 7,
  },
  timeButton: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#dbe1ea",
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: "#ffffff",
  },
  timeButtonLabel: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "700",
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    borderRadius: 20,
    backgroundColor: "#f8fafc",
    padding: 14,
  },
  switchTitle: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "800",
  },
  switchSubtitle: {
    color: "#64748b",
    fontSize: 13,
    marginTop: 2,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f766e",
  },
  primaryButtonText: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "800",
  },
  savedCard: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#ebe2d5",
    backgroundColor: "#fffcf8",
    gap: 8,
  },
  savedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  savedTitle: {
    color: "#0f172a",
    fontSize: 17,
    fontWeight: "800",
  },
  savedMeta: {
    color: "#475569",
    fontSize: 13,
    marginTop: 2,
  },
  savedStatus: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "#e2e8f0",
  },
  savedStatusActive: {
    backgroundColor: "#ccfbf1",
  },
  savedStatusText: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "700",
  },
  savedStatusTextActive: {
    color: "#0f766e",
  },
  savedDetail: {
    color: "#475569",
    fontSize: 14,
    lineHeight: 20,
  },
  savedActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  actionButton: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#ecfdf5",
  },
  actionButtonDestructive: {
    backgroundColor: "#fff1f2",
  },
  actionButtonText: {
    color: "#0f766e",
    fontWeight: "800",
    fontSize: 13,
  },
  actionButtonTextDestructive: {
    color: "#be123c",
  },
  bottomAdSpacer: {
    height: 120,
  },
  bottomAdShell: {
    paddingHorizontal: 18,
    paddingBottom: 14,
    paddingTop: 8,
    backgroundColor: "rgba(246, 241, 232, 0.96)",
  },
  bottomAdCard: {
    borderRadius: 22,
    backgroundColor: "#1e293b",
    padding: 16,
    borderWidth: 1,
    borderColor: "#334155",
    gap: 6,
  },
  bottomAdEyebrow: {
    color: "#7dd3fc",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  bottomAdTitle: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 23,
  },
  bottomAdBody: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 19,
  },
  bottomAdButton: {
    alignSelf: "flex-start",
    marginTop: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#22c55e",
  },
  bottomAdButtonText: {
    color: "#052e16",
    fontSize: 13,
    fontWeight: "800",
  },
});
