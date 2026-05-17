import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Platform,
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
  bg:           "#F4F7F5",
  card:         "#FFFFFF",
  border:       "#E8EDF0",
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

// ─── App root ─────────────────────────────────────────────────────────────────
export default function App() {
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

  // Data
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

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

  // Returns dose entries for the next `days` days
  const buildSchedule = (days: number) => {
    const now = new Date();
    const entries: Array<{
      key: string;
      plan: SavedPlan;
      doseTime: Date;
      date: Date;
      isPast: boolean;
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

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />

      <View style={s.body}>

        {/* ── ADD PEPTIDE TAB ──────────────────────────────────────────────── */}
        {activeTab === "add" && (
          <ScrollView
            contentContainerStyle={s.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.pageHead}>
              <Text style={s.pageTitle}>Add a Peptide</Text>
              <Text style={s.pageSub}>Enter vial details to calculate your dose options.</Text>
            </View>

            {/* Step 1: Peptide details */}
            <View style={s.card}>
              <Text style={s.stepBadge}>STEP 1 OF 3</Text>
              <Text style={s.cardTitle}>Peptide Details</Text>
              <Field
                label="Milligrams in vial"
                value={vialMg}
                onChangeText={setVialMg}
                placeholder="10"
                suffix="mg"
              />
              <Field
                label="Syringe capacity"
                value={syringeMaxMl}
                onChangeText={setSyringeMaxMl}
                placeholder="1"
                suffix="mL"
              />
              <Field
                label="Target dose"
                value={targetDoseMg}
                onChangeText={setTargetDoseMg}
                placeholder="2"
                suffix="mg"
              />
              {!calcDone && (
                <Pressable style={s.primaryBtn} onPress={handleCalculate}>
                  <Text style={s.primaryBtnText}>Calculate Options</Text>
                </Pressable>
              )}
            </View>

            {/* Step 2: BAC water selection — hidden until Step 1 complete */}
            {calcDone && selectedOption && (
              <View style={s.card}>
                <Text style={s.stepBadge}>STEP 2 OF 3</Text>
                <Text style={s.cardTitle}>Select BAC Water Amount</Text>
                <Text style={s.cardSub}>
                  Choose the amount that gives the easiest syringe reading.
                </Text>

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

            {/* Step 3: Name & Schedule — hidden until Step 1 complete */}
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

                <View style={s.rowFields}>
                  <View style={s.rowHalf}>
                    <Field
                      label="Dose every"
                      value={intervalDays}
                      onChangeText={setIntervalDays}
                      placeholder="3"
                      suffix="days"
                    />
                  </View>
                  <View style={s.rowHalf}>
                    <Text style={s.fieldLabel}>Reminder time</Text>
                    <Pressable style={s.timeBtn} onPress={() => setShowTimePicker(true)}>
                      <Text style={s.timeBtnText}>{fmtTime(reminderTime.toISOString())}</Text>
                    </Pressable>
                  </View>
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
        )}

        {/* ── DAILY SCHEDULE TAB ───────────────────────────────────────────── */}
        {activeTab === "schedule" && (
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            <View style={s.pageHead}>
              <Text style={s.pageTitle}>Daily Schedule</Text>
              <Text style={s.pageSub}>{fmtDateLong(new Date())}</Text>
            </View>

            <View style={s.schedSection}>
              <Text style={s.schedSectionTitle}>Today</Text>
              {todayEntries.length === 0 ? (
                <View style={s.empty}>
                  <Text style={s.emptyTitle}>No doses today</Text>
                  <Text style={s.emptySub}>
                    {plans.length === 0
                      ? "Add a peptide to start building your schedule."
                      : "You are all clear for today."}
                  </Text>
                </View>
              ) : (
                todayEntries.map(({ key, plan, doseTime, isPast }) => (
                  <View key={key} style={[s.schedItem, isPast && s.schedItemPast]}>
                    <View style={s.schedLeft}>
                      <View style={[s.dot, isPast ? s.dotPast : s.dotToday]} />
                      <Text style={[s.schedTime, isPast && s.schedTimePast]}>
                        {doseTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </Text>
                    </View>
                    <View style={s.schedRight}>
                      <Text style={[s.schedName, isPast && s.schedNamePast]}>{plan.name}</Text>
                      <Text style={s.schedDose}>
                        {formatMg(plan.targetDoseMg)} · Draw {formatMl(plan.selectedDrawMl)}
                      </Text>
                      {isPast && <Text style={s.schedDoneTag}>Done</Text>}
                    </View>
                  </View>
                ))
              )}
            </View>


            <View style={{ height: 16 }} />
          </ScrollView>
        )}

        {/* ── CABINET TAB ──────────────────────────────────────────────────── */}
        {activeTab === "cabinet" && (
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            <View style={s.pageHead}>
              <Text style={s.pageTitle}>Cabinet</Text>
              <Text style={s.pageSub}>
                {isBootstrapping
                  ? "Loading..."
                  : plans.length === 0
                  ? "No peptides saved yet."
                  : `${plans.length} peptide${plans.length === 1 ? "" : "s"} saved`}
              </Text>
            </View>

            {!isBootstrapping && plans.length === 0 ? (
              <View style={s.empty}>
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
                    {/* Header — always visible, tap to expand */}
                    <View style={s.cabHeader}>
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
                        <Text style={s.chevron}>{expanded ? "▲" : "▼"}</Text>
                      </View>
                    </View>

                    {/* Body — only shown when expanded */}
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
                          <Pressable
                            style={[s.cabBtn, plan.reminderEnabled ? s.cabBtnWarn : s.cabBtnPrimary]}
                            onPress={() => toggleReminder(plan)}
                          >
                            <Text
                              style={[
                                s.cabBtnText,
                                plan.reminderEnabled ? s.cabBtnTextWarn : s.cabBtnTextPrimary,
                              ]}
                            >
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
        )}
      </View>

      {/* ── BOTTOM TAB BAR ────────────────────────────────────────────────── */}
      <View style={s.tabBar}>
        <TabBtn
          icon="+"
          label="Add Peptide"
          active={activeTab === "add"}
          onPress={() => setActiveTab("add")}
        />
        <TabBtn
          icon="◷"
          label="Daily Schedule"
          active={activeTab === "schedule"}
          onPress={() => setActiveTab("schedule")}
        />
        <TabBtn
          icon="▤"
          label="Cabinet"
          active={activeTab === "cabinet"}
          onPress={() => setActiveTab("cabinet")}
        />
      </View>

      {showTimePicker && (
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
      )}
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  suffix?: string;
  keyboardType?: "default" | "decimal-pad";
};

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  suffix,
  keyboardType = "decimal-pad",
}: FieldProps) {
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

function DetailRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[s.detailRow, last && { borderBottomWidth: 0 }]}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value}</Text>
    </View>
  );
}

function TabBtn({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={s.tabBtn} onPress={onPress}>
      <Text style={[s.tabIcon, active && s.tabIconActive]}>{icon}</Text>
      <Text style={[s.tabLabel, active && s.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  body: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16, gap: 16 },

  pageHead:  { paddingTop: 8, paddingBottom: 4 },
  pageTitle: { fontSize: 30, fontWeight: "800", color: C.text, letterSpacing: -0.5 },
  pageSub:   { fontSize: 15, color: C.textSub, marginTop: 4 },

  card: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  stepBadge: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    color: C.primaryMid,
    textTransform: "uppercase",
  },
  cardTitle: { fontSize: 20, fontWeight: "800", color: C.text, marginTop: -4 },
  cardSub:   { fontSize: 14, color: C.textSub, lineHeight: 20, marginTop: -8 },

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

  rowFields: { flexDirection: "row", gap: 12 },
  rowHalf:   { flex: 1, gap: 6 },

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

  highlight: {
    backgroundColor: C.primaryLight,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#B7DFC9",
    gap: 4,
  },
  highlightLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: C.primaryMid,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  highlightValue: { fontSize: 30, fontWeight: "900", color: C.primary },
  highlightBody:  { fontSize: 14, color: "#2D6A4F", lineHeight: 20 },

  optCard:    { borderRadius: 16, padding: 14, backgroundColor: "#F8FAFC", borderWidth: 1.5, borderColor: C.border, gap: 4 },
  optCardSel: { backgroundColor: C.primaryLight, borderColor: C.accent },
  optRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  optTag:     { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7, color: C.textSub },
  optTagSel:  { color: C.primary },
  optDraw:    { fontSize: 17, fontWeight: "800", color: C.text },
  optText:    { fontSize: 13, color: C.textSub, lineHeight: 18 },

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

  primaryBtn:         { height: 54, borderRadius: 16, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText:     { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  ghostBtn:           { height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  ghostBtnText:       { color: C.textSub, fontSize: 14, fontWeight: "700" },

  empty:      { borderRadius: 16, padding: 20, backgroundColor: "#F8FAFC", borderWidth: 1, borderStyle: "dashed", borderColor: C.border, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: C.text },
  emptySub:   { fontSize: 14, color: C.textSub, textAlign: "center", lineHeight: 20 },

  schedSection:      { gap: 10 },
  schedSectionTitle: { fontSize: 17, fontWeight: "800", color: C.text },
  schedItem: {
    flexDirection: "row",
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "flex-start",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  schedItemPast:     { opacity: 0.55 },
  schedLeft:         { alignItems: "center", gap: 5, width: 52 },
  dot:               { width: 10, height: 10, borderRadius: 5, marginTop: 2 },
  dotToday:          { backgroundColor: C.primary },
  dotPast:           { backgroundColor: C.textMuted },
  dotUpcoming:       { backgroundColor: C.accent },
  schedTime:         { fontSize: 12, fontWeight: "700", color: C.primary, textAlign: "center" },
  schedTimePast:     { color: C.textMuted },
  schedTimeUpcoming: { fontSize: 11, fontWeight: "700", color: C.accent, textAlign: "center" },
  schedRight:        { flex: 1, gap: 2 },
  schedName:         { fontSize: 15, fontWeight: "800", color: C.text },
  schedNamePast:     { color: C.textSub },
  schedDose:         { fontSize: 13, color: C.textSub },
  schedDoneTag:      { fontSize: 11, fontWeight: "700", color: C.accent, marginTop: 2 },

  cabCard: {
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cabHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, gap: 12 },
  cabInfo:   { flex: 1 },
  cabName:   { fontSize: 17, fontWeight: "800", color: C.text },
  cabMeta:   { fontSize: 13, color: C.textSub, marginTop: 2 },
  cabRight:  { flexDirection: "row", alignItems: "center", gap: 10 },

  badge:           { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "#F1F5F9" },
  badgeActive:     { backgroundColor: C.primaryLight },
  badgeText:       { fontSize: 12, fontWeight: "700", color: C.textSub },
  badgeTextActive: { color: C.primary },
  chevron:         { fontSize: 12, color: C.textMuted },

  cabBody: { borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 16, paddingBottom: 16 },
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

  cabActions:       { flexDirection: "row", gap: 10, marginTop: 14 },
  cabBtn:           { flex: 1, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  cabBtnPrimary:    { backgroundColor: C.primaryLight, borderColor: "#B7DFC9" },
  cabBtnWarn:       { backgroundColor: C.warnLight, borderColor: "#FDE68A" },
  cabBtnText:       { fontSize: 13, fontWeight: "700" },
  cabBtnTextPrimary: { color: C.primary },
  cabBtnTextWarn:    { color: C.warn },
  cabBtnDanger:      { height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: C.dangerLight, paddingHorizontal: 16 },
  cabBtnTextDanger:  { fontSize: 13, fontWeight: "700", color: C.danger },

  tabBar: {
    flexDirection: "row",
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingBottom: Platform.OS === "ios" ? 20 : 8,
    paddingTop: 8,
    paddingHorizontal: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  tabBtn:        { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingVertical: 4 },
  tabIcon:       { fontSize: 22, color: C.textMuted },
  tabIconActive: { color: C.primary },
  tabLabel:       { fontSize: 10, fontWeight: "700", color: C.textMuted, textAlign: "center" },
  tabLabelActive: { color: C.primary },
});
