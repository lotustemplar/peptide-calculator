import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { SavedPlan } from "./src/types";
import { formatMg, formatMl, generateDoseOptions, parsePositiveNumber } from "./src/utils/calculator";
import {
  cancelReminderSeriesAsync,
  prepareNotificationsAsync,
  refreshActiveReminderWindowsAsync,
  requestReminderPermissionsAsync,
  scheduleReminderSeriesAsync,
} from "./src/utils/notifications";
import { loadPlans, savePlans } from "./src/utils/storage";

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  primary:      "#1B6B4A",
  primaryMid:   "#2D8A60",
  primaryLight: "#E8F5EE",
  accent:       "#52B788",
  bg:           "#F0F4F2",
  card:         "#FFFFFF",
  border:       "#E2EAE6",
  text:         "#1A2332",
  textSub:      "#64748B",
  textMuted:    "#94A3B8",
  danger:       "#DC2626",
  dangerLight:  "#FEF2F2",
  warn:         "#F59E0B",
  warnLight:    "#FFFBEB",
};

// ─── Types & helpers ──────────────────────────────────────────────────────────
type Tab = "add" | "schedule" | "cabinet";

const createPlanId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const defaultReminderTime = () => {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  return d;
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const fmtDateLong = (d: Date) =>
  d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

const isDoseDay = (plan: SavedPlan, date: Date): boolean => {
  const created = new Date(plan.createdAt);
  created.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - created.getTime()) / 86400000);
  return diff >= 0 && diff % plan.intervalDays === 0;
};

// ─── App root (provides safe-area context) ────────────────────────────────────
export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────
function AppContent() {
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<Tab>("add");

  // Calculator
  const [vialMg, setVialMg] = useState("10");
  const [syringeMaxMl, setSyringeMaxMl] = useState("1");
  const [targetDoseMg, setTargetDoseMg] = useState("2");
  const [calcDone, setCalcDone] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState("");

  // Plan creation
  const [planName, setPlanName] = useState("");
  const [intervalDays, setIntervalDays] = useState("3");
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderTime, setReminderTime] = useState(defaultReminderTime);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Time picker sub-state (shared between add + edit flows)
  const [pickerHour, setPickerHour] = useState(8);
  const [pickerMinute, setPickerMinute] = useState(0);
  const [pickerAmPm, setPickerAmPm] = useState<"AM" | "PM">("AM");
  const [timePickerTarget, setTimePickerTarget] = useState<"add" | "edit">("add");

  // Data
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  // Edit plan modal
  const [editingPlan, setEditingPlan] = useState<SavedPlan | null>(null);
  const [editName, setEditName] = useState("");
  const [editVialMg, setEditVialMg] = useState("");
  const [editSyringeMaxMl, setEditSyringeMaxMl] = useState("");
  const [editTargetDoseMg, setEditTargetDoseMg] = useState("");
  const [editIntervalDays, setEditIntervalDays] = useState("");
  const [editReminderTime, setEditReminderTime] = useState(defaultReminderTime);
  const [editReminderEnabled, setEditReminderEnabled] = useState(true);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const parsedVialMg       = parsePositiveNumber(vialMg);
  const parsedSyringeMaxMl = parsePositiveNumber(syringeMaxMl);
  const parsedTargetDoseMg = parsePositiveNumber(targetDoseMg);
  const parsedIntervalDays = Math.max(1, Math.round(parsePositiveNumber(intervalDays)));

  const options = useMemo(
    () => generateDoseOptions(parsedVialMg, parsedTargetDoseMg, parsedSyringeMaxMl),
    [parsedVialMg, parsedTargetDoseMg, parsedSyringeMaxMl],
  );

  const selectedOption = options.find((o) => o.id === selectedOptionId) ?? options[0] ?? null;

  useEffect(() => {
    if (!selectedOption) { setSelectedOptionId(""); return; }
    if (selectedOption.id !== selectedOptionId) setSelectedOptionId(selectedOption.id);
  }, [selectedOption, selectedOptionId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await prepareNotificationsAsync().catch(() => {});
      const stored = await loadPlans();
      let hydrated = stored;
      try {
        hydrated = await refreshActiveReminderWindowsAsync(stored);
        await savePlans(hydrated);
      } catch { hydrated = stored; }
      if (alive) { setPlans(hydrated); setIsBootstrapping(false); }
    })().catch(() => { if (alive) setIsBootstrapping(false); });
    return () => { alive = false; };
  }, []);

  const persistPlans = async (next: SavedPlan[]) => {
    setPlans(next);
    await savePlans(next);
  };

  const resetForm = () => {
    setVialMg("10"); setSyringeMaxMl("1"); setTargetDoseMg("2");
    setPlanName(""); setIntervalDays("3");
    setReminderEnabled(true); setReminderTime(defaultReminderTime());
    setCalcDone(false); setSelectedOptionId("");
  };

  const handleCalculate = () => {
    if (!parsedVialMg || !parsedSyringeMaxMl || !parsedTargetDoseMg)
      return Alert.alert("Missing details", "Enter all three values to continue.");
    if (parsedTargetDoseMg > parsedVialMg)
      return Alert.alert("Dose too high", "Target dose cannot exceed the vial total milligrams.");
    if (!options.length)
      return Alert.alert("No valid options", "Try a smaller dose or a larger syringe size.");
    setCalcDone(true);
  };

  const handleSavePlan = async () => {
    if (!selectedOption) return;
    setIsSaving(true);
    try {
      const plan: SavedPlan = {
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
        const ok = await requestReminderPermissionsAsync();
        if (!ok) {
          Alert.alert(
            "Notifications blocked",
            "Plan saved — enable notifications in device settings to get reminders.",
          );
          plan.reminderEnabled = false;
        } else {
          plan.notificationIds = await scheduleReminderSeriesAsync(plan);
        }
      }

      await persistPlans([plan, ...plans]);
      resetForm();
      Alert.alert("Peptide saved!", "Reminders are scheduled. Check the Cabinet tab to manage it.");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleReminder = async (plan: SavedPlan) => {
    const idx = plans.findIndex((p) => p.id === plan.id);
    if (idx < 0) return;
    const updated = [...plans];
    if (plan.reminderEnabled) {
      await cancelReminderSeriesAsync(plan.notificationIds);
      updated[idx] = { ...plan, reminderEnabled: false, notificationIds: [] };
    } else {
      const ok = await requestReminderPermissionsAsync();
      if (!ok) {
        Alert.alert("Notifications blocked", "Enable notifications in device settings first.");
        return;
      }
      const p2 = { ...plan, reminderEnabled: true };
      p2.notificationIds = await scheduleReminderSeriesAsync(p2);
      updated[idx] = p2;
    }
    await persistPlans(updated);
  };

  const deletePlan = (plan: SavedPlan) => {
    Alert.alert("Remove Peptide", `Delete "${plan.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await cancelReminderSeriesAsync(plan.notificationIds);
          await persistPlans(plans.filter((p) => p.id !== plan.id));
          if (expandedPlanId === plan.id) setExpandedPlanId(null);
        },
      },
    ]);
  };

  const openEditPlan = (plan: SavedPlan) => {
    setEditName(plan.name);
    setEditVialMg(String(plan.vialMg));
    setEditSyringeMaxMl(String(plan.syringeMaxMl));
    setEditTargetDoseMg(String(plan.targetDoseMg));
    setEditIntervalDays(String(plan.intervalDays));
    setEditReminderTime(new Date(plan.reminderTimeIso));
    setEditReminderEnabled(plan.reminderEnabled);
    setEditingPlan(plan);
  };

  const saveEditedPlan = async () => {
    if (!editingPlan) return;
    const parsedVial     = parsePositiveNumber(editVialMg);
    const parsedSyringe  = parsePositiveNumber(editSyringeMaxMl);
    const parsedDose     = parsePositiveNumber(editTargetDoseMg);
    const parsedInterval = Math.max(1, Math.round(parsePositiveNumber(editIntervalDays)));

    if (!parsedVial || !parsedSyringe || !parsedDose)
      return Alert.alert("Invalid values", "Enter valid numbers for all fields.");
    if (parsedDose > parsedVial)
      return Alert.alert("Dose too high", "Target dose cannot exceed vial milligrams.");

    const newOptions = generateDoseOptions(parsedVial, parsedDose, parsedSyringe);
    if (!newOptions.length)
      return Alert.alert("No valid options", "Try a smaller dose or a larger syringe.");

    setIsSavingEdit(true);
    try {
      await cancelReminderSeriesAsync(editingPlan.notificationIds);

      const best = newOptions[0];
      const updated: SavedPlan = {
        ...editingPlan,
        name: editName.trim() || editingPlan.name,
        vialMg: parsedVial,
        syringeMaxMl: parsedSyringe,
        targetDoseMg: parsedDose,
        selectedWaterMl: best.waterMl,
        selectedDrawMl: best.drawMl,
        concentrationMgPerMl: best.concentrationMgPerMl,
        intervalDays: parsedInterval,
        reminderTimeIso: editReminderTime.toISOString(),
        reminderEnabled: editReminderEnabled,
        notificationIds: [],
      };

      if (editReminderEnabled) {
        const ok = await requestReminderPermissionsAsync();
        if (ok) {
          updated.notificationIds = await scheduleReminderSeriesAsync(updated);
        } else {
          updated.reminderEnabled = false;
        }
      }

      const idx = plans.findIndex((p) => p.id === editingPlan.id);
      const next = [...plans];
      next[idx] = updated;
      await persistPlans(next);
      setEditingPlan(null);
      Alert.alert("Saved!", "Your plan has been updated.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const openTimePicker = () => {
    const src = reminderTime;
    const h = src.getHours();
    const m = src.getMinutes();
    const ampm: "AM" | "PM" = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 || 12;
    const minute = [0, 15, 30, 45].reduce((prev, curr) =>
      Math.abs(curr - m) < Math.abs(prev - m) ? curr : prev,
    );
    setPickerHour(hour12); setPickerMinute(minute); setPickerAmPm(ampm);
    setTimePickerTarget("add");
    setShowTimePicker(true);
  };

  const openEditTimePicker = () => {
    const src = editReminderTime;
    const h = src.getHours();
    const m = src.getMinutes();
    const ampm: "AM" | "PM" = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 || 12;
    const minute = [0, 15, 30, 45].reduce((prev, curr) =>
      Math.abs(curr - m) < Math.abs(prev - m) ? curr : prev,
    );
    setPickerHour(hour12); setPickerMinute(minute); setPickerAmPm(ampm);
    setTimePickerTarget("edit");
    setShowTimePicker(true);
  };

  const confirmTimePicker = () => {
    let hours = pickerHour;
    if (pickerAmPm === "AM" && hours === 12) hours = 0;
    if (pickerAmPm === "PM" && hours !== 12) hours += 12;
    if (timePickerTarget === "add") {
      const d = new Date(reminderTime);
      d.setHours(hours, pickerMinute, 0, 0);
      setReminderTime(d);
    } else {
      const d = new Date(editReminderTime);
      d.setHours(hours, pickerMinute, 0, 0);
      setEditReminderTime(d);
    }
    setShowTimePicker(false);
  };

  const buildSchedule = (days: number) => {
    const now = new Date();
    const entries: Array<{
      key: string; plan: SavedPlan; doseTime: Date; date: Date; isPast: boolean;
    }> = [];
    for (let d = 0; d < days; d++) {
      const date = new Date();
      date.setDate(date.getDate() + d);
      date.setHours(0, 0, 0, 0);
      for (const plan of plans) {
        if (!plan.reminderEnabled) continue;
        if (!isDoseDay(plan, date)) continue;
        const rt = new Date(plan.reminderTimeIso);
        const doseTime = new Date(date);
        doseTime.setHours(rt.getHours(), rt.getMinutes(), 0, 0);
        entries.push({ key: `${plan.id}-${d}`, plan, doseTime, date, isPast: doseTime < now });
      }
    }
    return entries.sort((a, b) => a.doseTime.getTime() - b.doseTime.getTime());
  };

  const todayEntries = buildSchedule(1);

  // Tab bar sits above the system nav bar
  const tabBarBottomPad = Math.max(insets.bottom, 6) + 6;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" backgroundColor={C.primary} />

      <View style={s.body}>

        {/* ── ADD PEPTIDE TAB ──────────────────────────────────────────────── */}
        {activeTab === "add" && (
          <>
            <View style={s.header}>
              <Text style={s.headerTitle}>Add a Peptide</Text>
              <Text style={s.headerSub}>Calculate your dose and build a plan.</Text>
            </View>
            <ScrollView
              contentContainerStyle={s.scroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Step 1 */}
              <View style={s.card}>
                <Text style={s.stepBadge}>STEP 1 OF 3</Text>
                <Text style={s.cardTitle}>Peptide Details</Text>

                <View style={s.imgFieldRow}>
                  <IlluVial />
                  <View style={s.imgFieldBody}>
                    <Field label="Milligrams in vial" value={vialMg} onChangeText={setVialMg} placeholder="10" suffix="mg" />
                  </View>
                </View>

                <View style={s.imgFieldRow}>
                  <IlluSyringe full />
                  <View style={s.imgFieldBody}>
                    <Field label="Syringe max capacity" value={syringeMaxMl} onChangeText={setSyringeMaxMl} placeholder="1" suffix="mL" />
                  </View>
                </View>

                <View style={s.imgFieldRow}>
                  <IlluSyringe />
                  <View style={s.imgFieldBody}>
                    <Field label="Target dose" value={targetDoseMg} onChangeText={setTargetDoseMg} placeholder="2" suffix="mg" />
                  </View>
                </View>

                {!calcDone && (
                  <Pressable style={s.primaryBtn} onPress={handleCalculate}>
                    <Text style={s.primaryBtnText}>Calculate Options</Text>
                  </Pressable>
                )}
              </View>

              {/* Step 2 — hidden until calc done */}
              {calcDone && selectedOption && (
                <View style={s.card}>
                  <Text style={s.stepBadge}>STEP 2 OF 3</Text>
                  <Text style={s.cardTitle}>Select BAC Water Amount</Text>
                  <Text style={s.cardSub}>Choose the amount that gives the easiest syringe reading.</Text>

                  <View style={s.highlight}>
                    <Text style={s.highlightLabel}>Best recommendation</Text>
                    <Text style={s.highlightValue}>{formatMl(selectedOption.drawMl)} to draw</Text>
                    <Text style={s.highlightBody}>
                      {formatMl(selectedOption.waterMl)} BAC water · {formatMg(selectedOption.concentrationMgPerMl)}/mL
                    </Text>
                  </View>

                  {options.map((opt, i) => {
                    const sel = selectedOption?.id === opt.id;
                    return (
                      <Pressable
                        key={opt.id}
                        onPress={() => setSelectedOptionId(opt.id)}
                        style={[s.optCard, sel && s.optCardSel]}
                      >
                        <View style={s.optRow}>
                          <Text style={[s.optTag, sel && s.optTagSel]}>
                            {i === 0 ? "Best fit" : `Option ${i + 1}`}
                          </Text>
                          <Text style={s.optDraw}>{formatMl(opt.drawMl)}</Text>
                        </View>
                        <Text style={s.optText}>
                          {formatMl(opt.waterMl)} BAC water · {opt.unitsOnOneMlSyringe} units · {formatMg(opt.concentrationMgPerMl)}/mL
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Step 3 — hidden until calc done */}
              {calcDone && selectedOption && (
                <View style={s.card}>
                  <Text style={s.stepBadge}>STEP 3 OF 3</Text>
                  <Text style={s.cardTitle}>Name & Schedule</Text>

                  <Field
                    label="Plan name (optional)"
                    value={planName}
                    onChangeText={setPlanName}
                    placeholder="e.g. BPC-157 morning"
                    keyboardType="default"
                  />

                  <View style={s.imgFieldRow}>
                    <IlluCalendar />
                    <View style={s.imgFieldBody}>
                      <Field label="Dose every" value={intervalDays} onChangeText={setIntervalDays} placeholder="3" suffix="days" />
                    </View>
                  </View>

                  <View style={s.fieldBlock}>
                    <Text style={s.fieldLabel}>Reminder time</Text>
                    <Pressable style={s.timeBtn} onPress={openTimePicker}>
                      <Text style={s.timeBtnText}>{fmtTime(reminderTime.toISOString())}</Text>
                    </Pressable>
                  </View>

                  <View style={s.switchRow}>
                    <View style={s.switchInfo}>
                      <Text style={s.switchTitle}>Enable dose reminders</Text>
                      <Text style={s.switchSub}>Get notified when it is time to dose</Text>
                    </View>
                    <Switch
                      value={reminderEnabled}
                      onValueChange={setReminderEnabled}
                      trackColor={{ true: C.primary, false: "#CBD5E1" }}
                      thumbColor="#FFFFFF"
                    />
                  </View>

                  <Pressable
                    style={[s.primaryBtn, isSaving && s.primaryBtnDisabled]}
                    onPress={handleSavePlan}
                    disabled={isSaving}
                  >
                    <Text style={s.primaryBtnText}>
                      {isSaving ? "Saving..." : "Save Peptide Plan"}
                    </Text>
                  </Pressable>

                  <Pressable style={s.ghostBtn} onPress={resetForm}>
                    <Text style={s.ghostBtnText}>Start over</Text>
                  </Pressable>
                </View>
              )}

              <View style={{ height: 16 }} />
            </ScrollView>
          </>
        )}

        {/* ── DAILY SCHEDULE TAB ───────────────────────────────────────────── */}
        {activeTab === "schedule" && (
          <>
            <View style={s.header}>
              <Text style={s.headerTitle}>Daily Schedule</Text>
              <Text style={s.headerSub}>{fmtDateLong(new Date())}</Text>
            </View>
            <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
              {todayEntries.length === 0 ? (
                <View style={s.empty}>
                  <Ionicons name="checkmark-circle-outline" size={48} color={C.accent} style={{ marginBottom: 8 }} />
                  <Text style={s.emptyTitle}>No doses today</Text>
                  <Text style={s.emptySub}>
                    {plans.length === 0
                      ? "Add a peptide to start building your schedule."
                      : "You are all clear for today."}
                  </Text>
                </View>
              ) : (
                <View style={s.schedList}>
                  {todayEntries.map(({ key, plan, doseTime, isPast }) => (
                    <View key={key} style={[s.schedItem, isPast && s.schedItemPast]}>
                      <View style={[s.schedIconWrap, isPast ? s.schedIconWrapPast : s.schedIconWrapToday]}>
                        <Ionicons
                          name={isPast ? "checkmark" : "time-outline"}
                          size={16}
                          color={isPast ? C.textMuted : C.primary}
                        />
                      </View>
                      <View style={s.schedContent}>
                        <Text style={[s.schedName, isPast && s.schedNamePast]}>{plan.name}</Text>
                        <Text style={s.schedDose}>
                          {formatMg(plan.targetDoseMg)} · Draw {formatMl(plan.selectedDrawMl)}
                        </Text>
                      </View>
                      <View style={s.schedTimeWrap}>
                        <Text style={[s.schedTime, isPast && s.schedTimePast]}>
                          {doseTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </Text>
                        {isPast && <Text style={s.schedDoneTag}>Done</Text>}
                      </View>
                    </View>
                  ))}
                </View>
              )}
              <View style={{ height: 16 }} />
            </ScrollView>
          </>
        )}

        {/* ── CABINET TAB ──────────────────────────────────────────────────── */}
        {activeTab === "cabinet" && (
          <>
            <View style={s.header}>
              <Text style={s.headerTitle}>Cabinet</Text>
              <Text style={s.headerSub}>
                {isBootstrapping
                  ? "Loading..."
                  : plans.length === 0
                  ? "No peptides saved yet."
                  : `${plans.length} peptide${plans.length === 1 ? "" : "s"} saved`}
              </Text>
            </View>
            <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
              {!isBootstrapping && plans.length === 0 ? (
                <View style={s.empty}>
                  <Ionicons name="flask-outline" size={48} color={C.accent} style={{ marginBottom: 8 }} />
                  <Text style={s.emptyTitle}>Your cabinet is empty</Text>
                  <Text style={s.emptySub}>Add a peptide using the Add tab to get started.</Text>
                  <Pressable
                    style={[s.primaryBtn, { marginTop: 14, alignSelf: "stretch" }]}
                    onPress={() => setActiveTab("add")}
                  >
                    <Text style={s.primaryBtnText}>Add a Peptide</Text>
                  </Pressable>
                </View>
              ) : (
                plans.map((plan) => {
                  const expanded = expandedPlanId === plan.id;
                  return (
                    <Pressable
                      key={plan.id}
                      style={s.cabCard}
                      onPress={() => setExpandedPlanId(expanded ? null : plan.id)}
                    >
                      {/* Header — always visible */}
                      <View style={s.cabHeader}>
                        <View style={s.cabIconWrap}>
                          <Ionicons name="flask" size={20} color={C.primary} />
                        </View>
                        <View style={s.cabInfo}>
                          <Text style={s.cabName}>{plan.name}</Text>
                          <Text style={s.cabMeta}>
                            {formatMg(plan.targetDoseMg)} · every {plan.intervalDays} day
                            {plan.intervalDays === 1 ? "" : "s"}
                          </Text>
                        </View>
                        <View style={s.cabRight}>
                          <View style={[s.badge, plan.reminderEnabled && s.badgeActive]}>
                            <Text style={[s.badgeText, plan.reminderEnabled && s.badgeTextActive]}>
                              {plan.reminderEnabled ? "Active" : "Off"}
                            </Text>
                          </View>
                          <Ionicons
                            name={expanded ? "chevron-up" : "chevron-down"}
                            size={18}
                            color={C.textMuted}
                          />
                        </View>
                      </View>

                      {/* Body — shown when expanded */}
                      {expanded && (
                        <View style={s.cabBody}>
                          <DetailRow label="Vial strength"  value={formatMg(plan.vialMg)} />
                          <DetailRow label="BAC water"      value={formatMl(plan.selectedWaterMl)} />
                          <DetailRow label="Concentration"  value={`${formatMg(plan.concentrationMgPerMl)}/mL`} />
                          <DetailRow label="Draw amount"    value={formatMl(plan.selectedDrawMl)} />
                          <DetailRow
                            label="Schedule"
                            value={`Every ${plan.intervalDays} day${plan.intervalDays === 1 ? "" : "s"} at ${fmtTime(plan.reminderTimeIso)}`}
                            last
                          />
                          <View style={s.cabActions}>
                            <Pressable style={s.cabBtnEdit} onPress={() => openEditPlan(plan)}>
                              <Ionicons name="create-outline" size={16} color={C.primary} />
                              <Text style={s.cabBtnTextEdit}>Edit Plan</Text>
                            </Pressable>
                          </View>
                          <View style={s.cabActions}>
                            <Pressable
                              style={[s.cabBtn, plan.reminderEnabled ? s.cabBtnWarn : s.cabBtnPrimary]}
                              onPress={() => toggleReminder(plan)}
                            >
                              <Text style={[s.cabBtnText, plan.reminderEnabled ? s.cabBtnTextWarn : s.cabBtnTextPrimary]}>
                                {plan.reminderEnabled ? "Pause Reminders" : "Enable Reminders"}
                              </Text>
                            </Pressable>
                            <Pressable style={s.cabBtnDanger} onPress={() => deletePlan(plan)}>
                              <Text style={s.cabBtnTextDanger}>Delete</Text>
                            </Pressable>
                          </View>
                        </View>
                      )}
                    </Pressable>
                  );
                })
              )}
              <View style={{ height: 16 }} />
            </ScrollView>
          </>
        )}

      </View>

      {/* ── BOTTOM TAB BAR ────────────────────────────────────────────────── */}
      <View style={[s.tabBar, { paddingBottom: tabBarBottomPad }]}>
        <TabBtn iconName="add-circle" label="Add Peptide"     active={activeTab === "add"}      onPress={() => setActiveTab("add")} />
        <TabBtn iconName="time"       label="Daily Schedule"  active={activeTab === "schedule"}  onPress={() => setActiveTab("schedule")} />
        <TabBtn iconName="grid"       label="Cabinet"         active={activeTab === "cabinet"}   onPress={() => setActiveTab("cabinet")} />
      </View>

      {/* ── EDIT PLAN MODAL ──────────────────────────────────────────────── */}
      <Modal
        visible={editingPlan !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingPlan(null)}
      >
        <View style={s.editOverlay}>
          <View style={s.editSheet}>
            {/* Header */}
            <View style={s.editSheetHeader}>
              <Text style={s.editSheetTitle}>Edit Plan</Text>
              <Pressable onPress={() => setEditingPlan(null)} style={s.editCloseBtn}>
                <Ionicons name="close" size={22} color={C.textSub} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={s.editScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Field label="Plan name" value={editName} onChangeText={setEditName} placeholder="e.g. BPC-157" keyboardType="default" />

              <View style={s.editDivider}><Text style={s.editDividerText}>Peptide & Syringe</Text></View>
              <Field label="Total mg in vial" value={editVialMg} onChangeText={setEditVialMg} placeholder="10" suffix="mg" />
              <Field label="Syringe max capacity" value={editSyringeMaxMl} onChangeText={setEditSyringeMaxMl} placeholder="1" suffix="mL" />
              <Field label="Target dose" value={editTargetDoseMg} onChangeText={setEditTargetDoseMg} placeholder="2" suffix="mg" />

              <View style={s.editDivider}><Text style={s.editDividerText}>Schedule</Text></View>
              <Field label="Dose every" value={editIntervalDays} onChangeText={setEditIntervalDays} placeholder="3" suffix="days" />

              <View style={s.fieldBlock}>
                <Text style={s.fieldLabel}>Reminder time</Text>
                <Pressable style={s.timeBtn} onPress={openEditTimePicker}>
                  <Text style={s.timeBtnText}>{fmtTime(editReminderTime.toISOString())}</Text>
                </Pressable>
              </View>

              <View style={s.switchRow}>
                <View style={s.switchInfo}>
                  <Text style={s.switchTitle}>Enable dose reminders</Text>
                  <Text style={s.switchSub}>Get notified when it is time to dose</Text>
                </View>
                <Switch
                  value={editReminderEnabled}
                  onValueChange={setEditReminderEnabled}
                  trackColor={{ true: C.primary, false: "#CBD5E1" }}
                  thumbColor="#FFFFFF"
                />
              </View>

              <Pressable
                style={[s.primaryBtn, isSavingEdit && s.primaryBtnDisabled]}
                onPress={saveEditedPlan}
                disabled={isSavingEdit}
              >
                <Text style={s.primaryBtnText}>{isSavingEdit ? "Saving..." : "Save Changes"}</Text>
              </Pressable>
              <Pressable style={s.ghostBtn} onPress={() => setEditingPlan(null)}>
                <Text style={s.ghostBtnText}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── TIME PICKER MODAL ─────────────────────────────────────────────── */}
      <Modal
        visible={showTimePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTimePicker(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowTimePicker(false)}>
          <Pressable style={s.timePickerBox} onPress={() => {}}>
            <Text style={s.timePickerTitle}>Set Reminder Time</Text>

            {/* Live preview */}
            <View style={s.timePreview}>
              <Text style={s.timePreviewText}>
                {pickerHour}:{String(pickerMinute).padStart(2, "0")} {pickerAmPm}
              </Text>
            </View>

            {/* Hour grid */}
            <Text style={s.timePickerSection}>Hour</Text>
            <View style={s.hourGrid}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                <Pressable
                  key={h}
                  style={[s.hourBtn, pickerHour === h && s.hourBtnActive]}
                  onPress={() => setPickerHour(h)}
                >
                  <Text style={[s.hourBtnText, pickerHour === h && s.hourBtnTextActive]}>{h}</Text>
                </Pressable>
              ))}
            </View>

            {/* Minute row */}
            <Text style={s.timePickerSection}>Minute</Text>
            <View style={s.minuteRow}>
              {[0, 15, 30, 45].map((m) => (
                <Pressable
                  key={m}
                  style={[s.minuteBtn, pickerMinute === m && s.minuteBtnActive]}
                  onPress={() => setPickerMinute(m)}
                >
                  <Text style={[s.minuteBtnText, pickerMinute === m && s.minuteBtnTextActive]}>
                    :{String(m).padStart(2, "0")}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* AM / PM */}
            <Text style={s.timePickerSection}>AM / PM</Text>
            <View style={s.ampmRow}>
              {(["AM", "PM"] as const).map((ap) => (
                <Pressable
                  key={ap}
                  style={[s.ampmBtn, pickerAmPm === ap && s.ampmBtnActive]}
                  onPress={() => setPickerAmPm(ap)}
                >
                  <Text style={[s.ampmBtnText, pickerAmPm === ap && s.ampmBtnTextActive]}>{ap}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable style={[s.primaryBtn, { marginTop: 8 }]} onPress={confirmTimePicker}>
              <Text style={s.primaryBtnText}>Set Time</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Step Illustrations ───────────────────────────────────────────────────────

/** Glass vial — represents total mg/IU inside the vial */
function IlluVial() {
  return (
    <View style={ill.vialWrap}>
      {/* metal cap */}
      <View style={ill.vialCap} />
      {/* narrow neck */}
      <View style={ill.vialNeck} />
      {/* glass body */}
      <View style={ill.vialBody}>
        {/* liquid fill */}
        <View style={ill.vialFill} />
        <Text style={ill.vialLabel}>mg</Text>
      </View>
      <Text style={ill.illuCaption}>Total in vial</Text>
    </View>
  );
}

/** Syringe — full = shows max capacity, partial = shows a single dose */
function IlluSyringe({ full = false }: { full?: boolean }) {
  return (
    <View style={ill.syrWrap}>
      {/* vertical syringe */}
      <View style={ill.syrNeedleTip} />
      <View style={ill.syrNeedle} />
      <View style={ill.syrBarrel}>
        {/* fill level */}
        <View style={[ill.syrFill, { height: full ? "90%" : "38%" }]} />
        {/* tick marks */}
        {[1, 2, 3].map((i) => (
          <View key={i} style={[ill.syrTick, { top: `${i * 22}%` as any }]} />
        ))}
        <Text style={ill.syrLabel}>{full ? "max" : "dose"}</Text>
      </View>
      <View style={ill.syrPlunger} />
      <Text style={ill.illuCaption}>{full ? "Syringe size" : "Your dose"}</Text>
    </View>
  );
}

/** Calendar grid — represents the dosing interval (every X days) */
function IlluCalendar() {
  const doseDays = [1, 4, 7, 10, 13];
  const cells = Array.from({ length: 14 }, (_, i) => i + 1);
  return (
    <View style={ill.calWrap}>
      <View style={ill.calHeader}>
        <Text style={ill.calHeaderText}>DOSE DAYS</Text>
      </View>
      <View style={ill.calGrid}>
        {cells.map((d) => {
          const on = doseDays.includes(d);
          return (
            <View key={d} style={[ill.calCell, on && ill.calCellOn]}>
              {on && <View style={ill.calDot} />}
            </View>
          );
        })}
      </View>
      <Text style={ill.illuCaption}>Dose schedule</Text>
    </View>
  );
}

const ill = StyleSheet.create({
  // ── Shared caption
  illuCaption: { fontSize: 9, fontWeight: "700", color: "#64748B", textAlign: "center", marginTop: 4 },

  // ── Vial
  vialWrap:  { width: 64, alignItems: "center" },
  vialCap:   { width: 26, height: 9, backgroundColor: "#94A3B8", borderRadius: 3 },
  vialNeck:  { width: 14, height: 6, backgroundColor: "#CBD5E1" },
  vialBody: {
    width: 32, height: 42,
    borderWidth: 2, borderColor: "#3B82F6",
    borderTopLeftRadius: 2, borderTopRightRadius: 2,
    borderBottomLeftRadius: 6, borderBottomRightRadius: 6,
    backgroundColor: "rgba(239,246,255,0.7)",
    overflow: "hidden",
    alignItems: "center", justifyContent: "center",
  },
  vialFill:  { position: "absolute", bottom: 0, left: 0, right: 0, height: 24, backgroundColor: "rgba(147,197,253,0.55)" },
  vialLabel: { fontSize: 13, fontWeight: "900", color: "#1D4ED8", zIndex: 1 },

  // ── Syringe (vertical)
  syrWrap:      { width: 64, alignItems: "center" },
  syrNeedleTip: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 10, borderStyle: "solid", borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: "#94A3B8" },
  syrNeedle:    { width: 4, height: 8, backgroundColor: "#94A3B8" },
  syrBarrel: {
    width: 28, height: 42,
    borderWidth: 2, borderColor: "#3B82F6",
    backgroundColor: "rgba(239,246,255,0.7)",
    overflow: "hidden",
    alignItems: "center", justifyContent: "flex-end",
  },
  syrFill:   { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(147,197,253,0.6)" },
  syrTick:   { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: "rgba(59,130,246,0.4)" },
  syrLabel:  { fontSize: 8, fontWeight: "800", color: "#1E40AF", marginBottom: 3, zIndex: 1 },
  syrPlunger: { width: 36, height: 8, backgroundColor: "#CBD5E1", borderRadius: 2, marginTop: 1 },

  // ── Calendar
  calWrap:       { width: 64, alignItems: "center" },
  calHeader:     { width: "100%", height: 14, backgroundColor: "#1B6B4A", borderTopLeftRadius: 5, borderTopRightRadius: 5, alignItems: "center", justifyContent: "center" },
  calHeaderText: { fontSize: 7, fontWeight: "800", color: "#FFFFFF", letterSpacing: 0.5 },
  calGrid: {
    width: "100%",
    flexDirection: "row", flexWrap: "wrap",
    borderWidth: 1, borderTopWidth: 0, borderColor: "#CBD5E1",
    borderBottomLeftRadius: 5, borderBottomRightRadius: 5,
    overflow: "hidden",
  },
  calCell:    { width: "14.28%", aspectRatio: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F8FAFC" },
  calCellOn:  { backgroundColor: "#E8F5EE" },
  calDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: "#1B6B4A" },
});

// ─── Sub-components ───────────────────────────────────────────────────────────

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  suffix?: string;
  keyboardType?: "default" | "decimal-pad";
};

function Field({ label, value, onChangeText, placeholder, suffix, keyboardType = "decimal-pad" }: FieldProps) {
  return (
    <View style={s.fieldBlock}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.inputShell}>
        <TextInput
          style={s.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.textMuted}
          keyboardType={keyboardType}
        />
        {suffix ? <Text style={s.inputSuffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

function DetailRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[s.detailRow, last && { borderBottomWidth: 0 }]}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value}</Text>
    </View>
  );
}

function TabBtn({
  iconName,
  label,
  active,
  onPress,
}: {
  iconName: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={s.tabBtn} onPress={onPress}>
      <Ionicons
        name={(active ? iconName : `${iconName}-outline`) as any}
        size={26}
        color={active ? C.primary : C.textMuted}
      />
      <Text style={[s.tabLabel, active && s.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Layout
  root:   { flex: 1, backgroundColor: C.primary },
  body:   { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16, gap: 16 },

  // Colored page header (inside each tab)
  header:      { backgroundColor: C.primary, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20 },
  headerTitle: { fontSize: 28, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.5 },
  headerSub:   { fontSize: 14, color: "rgba(255,255,255,0.7)", marginTop: 4 },

  // Cards
  card: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  stepBadge: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, color: C.primaryMid, textTransform: "uppercase" },
  cardTitle: { fontSize: 20, fontWeight: "800", color: C.text, marginTop: -4 },
  cardSub:   { fontSize: 14, color: C.textSub, lineHeight: 20, marginTop: -8 },

  // Step illustrations
  imgFieldRow:  { flexDirection: "row", alignItems: "center", gap: 12 },
  imgFieldBody: { flex: 1 },
  stepImg:      { width: 72, height: 72 },

  // Form fields
  fieldBlock:  { gap: 6 },
  fieldLabel:  { fontSize: 13, fontWeight: "700", color: C.text },
  inputShell: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: "#FAFCFB",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
  },
  input:       { flex: 1, fontSize: 16, fontWeight: "600", color: C.text },
  inputSuffix: { fontSize: 13, fontWeight: "700", color: C.textMuted },
  rowFields:   { flexDirection: "row", gap: 12 },
  rowHalf:     { flex: 1, gap: 6 },

  timeBtn: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: "#FAFCFB",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  timeBtnText: { fontSize: 16, fontWeight: "600", color: C.text },

  // Highlight box
  highlight: {
    backgroundColor: C.primaryLight,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#B7DFC9",
    gap: 4,
  },
  highlightLabel: { fontSize: 11, fontWeight: "800", color: C.primaryMid, textTransform: "uppercase", letterSpacing: 0.8 },
  highlightValue: { fontSize: 30, fontWeight: "900", color: C.primary },
  highlightBody:  { fontSize: 14, color: "#2D6A4F", lineHeight: 20 },

  // Option cards
  optCard:    { borderRadius: 16, padding: 14, backgroundColor: "#F8FAFC", borderWidth: 1.5, borderColor: C.border, gap: 4 },
  optCardSel: { backgroundColor: C.primaryLight, borderColor: C.accent },
  optRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  optTag:     { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7, color: C.textSub },
  optTagSel:  { color: C.primary },
  optDraw:    { fontSize: 17, fontWeight: "800", color: C.text },
  optText:    { fontSize: 13, color: C.textSub, lineHeight: 18 },

  // Reminder switch
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  switchInfo:  { flex: 1 },
  switchTitle: { fontSize: 15, fontWeight: "700", color: C.text },
  switchSub:   { fontSize: 13, color: C.textSub, marginTop: 2 },

  // Buttons
  primaryBtn:         { height: 54, borderRadius: 16, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText:     { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  ghostBtn:           { height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  ghostBtnText:       { color: C.textSub, fontSize: 14, fontWeight: "700" },

  // Empty states
  empty:      { borderRadius: 20, padding: 28, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: C.text },
  emptySub:   { fontSize: 14, color: C.textSub, textAlign: "center", lineHeight: 20 },

  // Schedule
  schedList: { gap: 10 },
  schedItem: {
    flexDirection: "row",
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  schedItemPast:     { opacity: 0.55 },
  schedIconWrap:     { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  schedIconWrapToday: { backgroundColor: C.primaryLight },
  schedIconWrapPast:  { backgroundColor: "#F1F5F9" },
  schedContent:      { flex: 1, gap: 2 },
  schedName:         { fontSize: 15, fontWeight: "800", color: C.text },
  schedNamePast:     { color: C.textSub },
  schedDose:         { fontSize: 13, color: C.textSub },
  schedTimeWrap:     { alignItems: "flex-end", gap: 2 },
  schedTime:         { fontSize: 13, fontWeight: "700", color: C.primary },
  schedTimePast:     { color: C.textMuted },
  schedDoneTag:      { fontSize: 11, fontWeight: "700", color: C.accent },

  // Cabinet
  cabCard: {
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
  },
  cabHeader:  { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  cabIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.primaryLight, alignItems: "center", justifyContent: "center" },
  cabInfo:    { flex: 1 },
  cabName:    { fontSize: 17, fontWeight: "800", color: C.text },
  cabMeta:    { fontSize: 13, color: C.textSub, marginTop: 2 },
  cabRight:   { flexDirection: "row", alignItems: "center", gap: 10 },

  badge:           { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "#F1F5F9" },
  badgeActive:     { backgroundColor: C.primaryLight },
  badgeText:       { fontSize: 12, fontWeight: "700", color: C.textSub },
  badgeTextActive: { color: C.primary },

  cabBody:    { borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 16, paddingBottom: 16 },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  detailLabel: { fontSize: 14, color: C.textSub },
  detailValue: { fontSize: 14, fontWeight: "700", color: C.text },

  cabActions:        { flexDirection: "row", gap: 10, marginTop: 10 },
  cabBtn:            { flex: 1, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  cabBtnPrimary:     { backgroundColor: C.primaryLight, borderColor: "#B7DFC9" },
  cabBtnWarn:        { backgroundColor: C.warnLight, borderColor: "#FDE68A" },
  cabBtnText:        { fontSize: 13, fontWeight: "700" },
  cabBtnTextPrimary: { color: C.primary },
  cabBtnTextWarn:    { color: C.warn },
  cabBtnDanger:      { height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: C.dangerLight, paddingHorizontal: 16 },
  cabBtnTextDanger:  { fontSize: 13, fontWeight: "700", color: C.danger },
  cabBtnEdit:        { flex: 1, height: 44, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: C.primaryLight, borderWidth: 1, borderColor: "#B7DFC9" },
  cabBtnTextEdit:    { fontSize: 14, fontWeight: "800", color: C.primary },

  // Edit modal (bottom sheet)
  editOverlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  editSheet:       { backgroundColor: C.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "92%", paddingBottom: 20 },
  editSheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  editSheetTitle:  { fontSize: 20, fontWeight: "800", color: C.text },
  editCloseBtn:    { width: 34, height: 34, borderRadius: 17, backgroundColor: "#F1F5F9", alignItems: "center", justifyContent: "center" },
  editScroll:      { padding: 20, gap: 14, paddingBottom: 16 },
  editDivider:     { paddingTop: 4, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: C.border },
  editDividerText: { fontSize: 12, fontWeight: "800", color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.8, paddingBottom: 8 },

  // Tab bar — paddingBottom applied inline via insets
  tabBar: {
    flexDirection: "row",
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 8,
    paddingHorizontal: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 12,
  },
  tabBtn:        { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 4 },
  tabLabel:      { fontSize: 10, fontWeight: "700", color: C.textMuted, textAlign: "center" },
  tabLabelActive: { color: C.primary },

  // Time picker modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  timePickerBox: {
    width: "100%",
    backgroundColor: C.card,
    borderRadius: 24,
    padding: 24,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 16,
  },
  timePickerTitle: { fontSize: 18, fontWeight: "800", color: C.text, textAlign: "center" },

  timePreview: {
    backgroundColor: C.primaryLight,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
  },
  timePreviewText: { fontSize: 36, fontWeight: "900", color: C.primary, letterSpacing: -1 },

  timePickerSection: { fontSize: 12, fontWeight: "800", color: C.textMuted, textTransform: "uppercase", letterSpacing: 1 },

  hourGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hourBtn: {
    width: 52,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  hourBtnActive:     { backgroundColor: C.primary },
  hourBtnText:       { fontSize: 16, fontWeight: "700", color: C.text },
  hourBtnTextActive: { color: "#FFFFFF" },

  minuteRow: { flexDirection: "row", gap: 8 },
  minuteBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  minuteBtnActive:     { backgroundColor: C.primary },
  minuteBtnText:       { fontSize: 16, fontWeight: "700", color: C.text },
  minuteBtnTextActive: { color: "#FFFFFF" },

  ampmRow: { flexDirection: "row", gap: 12 },
  ampmBtn: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  ampmBtnActive:     { backgroundColor: C.primary },
  ampmBtnText:       { fontSize: 18, fontWeight: "800", color: C.text },
  ampmBtnTextActive: { color: "#FFFFFF" },
});
