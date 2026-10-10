import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, TextInput, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../constants/colors";
import { radius } from "../constants/spacing";
import { GreenButton } from "../components/GreenButton";
import type { DomainError, Result } from "../domain";
import type { AdminPage, AdminAuditEvent } from "./adminTypes";
import { ACTOR_ROLE_LABEL, AUDIT_ENTITY_LABEL, auditDetails, auditEventText, formatStamp, LoadFailure, loadFailure, pageSummary } from "./adminViews";

// ---------------------------------------------------------------------------
// Data hooks

export type LoadState<T> = { phase: "loading" } | { phase: "failed"; failure: LoadFailure } | { phase: "ready"; data: T };

/** One server read (re-run when `key` changes). Stale answers are ignored. */
export function useAdminLoad<T>(load: () => Promise<Result<T>>, key: string): LoadState<T> & { reload: () => void } {
  const [state, setState] = useState<LoadState<T>>({ phase: "loading" });
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useCallback(() => {
    const my = ++seq.current;
    setState({ phase: "loading" });
    void loadRef.current().then(
      (r) => {
        if (my !== seq.current) return;
        setState(r.ok ? { phase: "ready", data: r.value } : { phase: "failed", failure: loadFailure(r.error) });
      },
      () => my === seq.current && setState({ phase: "failed", failure: { kind: "error", message: "Something went wrong. Please try again." } })
    );
  }, []);
  useEffect(run, [key, run]);
  return { ...state, reload: run };
}

export type PagedState<T, X = unknown> = {
  rows: T[];
  total: number;
  extra?: X;
  loading: boolean;
  /** First page failed (nothing to show). */
  failure: LoadFailure | null;
  /** A later page failed (rows stay; "Load more" retries). */
  moreFailure: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
};

/**
 * Server-paginated list. `key` = the filters: a change starts again at page 1
 * (filtering happens on the server, never on the rows already loaded).
 */
export function useAdminPaged<T, X = unknown>(fetchPage: (offset: number) => Promise<Result<AdminPage<T> & { summary?: X }>>, key: string): PagedState<T, X> {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [extra, setExtra] = useState<X | undefined>(undefined);
  const [next, setNext] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [moreFailure, setMoreFailure] = useState<string | null>(null);
  const seq = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const load = useCallback((offset: number, reset: boolean) => {
    const my = ++seq.current;
    setLoading(true);
    if (reset) {
      setFailure(null);
      setRows([]);
    }
    setMoreFailure(null);
    void fetchRef.current(offset).then(
      (r) => {
        if (my !== seq.current) return;
        setLoading(false);
        if (!r.ok) {
          const f = loadFailure(r.error);
          if (reset) setFailure(f);
          else setMoreFailure(f.kind === "error" ? f.message : "Could not load more.");
          return;
        }
        setRows((prev) => (reset ? r.value.rows : [...prev, ...r.value.rows]));
        setTotal(r.value.total);
        setNext(r.value.nextOffset);
        if (r.value.summary !== undefined) setExtra(r.value.summary);
      },
      () => {
        if (my !== seq.current) return;
        setLoading(false);
        if (reset) setFailure({ kind: "error", message: "Something went wrong. Please try again." });
        else setMoreFailure("Could not load more.");
      }
    );
  }, []);

  useEffect(() => load(0, true), [key, load]);
  return {
    rows,
    total,
    extra,
    loading,
    failure,
    moreFailure,
    hasMore: next !== null,
    loadMore: () => {
      if (!loading && next !== null) load(next, false);
    },
    reload: () => load(0, true),
  };
}

// ---------------------------------------------------------------------------
// States

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.state} accessibilityLabel={label}>
      <ActivityIndicator color={colors.greenDark} />
      <Text style={styles.stateText}>{label}</Text>
    </View>
  );
}

export function FailureState({ failure, onRetry }: { failure: LoadFailure; onRetry: () => void }) {
  if (failure.kind === "unauthorized") {
    return (
      <View style={styles.state} accessibilityRole="alert">
        <Ionicons name="lock-closed-outline" size={28} color={colors.textSecondary} />
        <Text style={styles.stateTitle}>No access</Text>
        <Text style={styles.stateText}>The operations console is for active supervisors and administrators of this organization.</Text>
      </View>
    );
  }
  if (failure.kind === "session") {
    return (
      <View style={styles.state} accessibilityRole="alert">
        <Ionicons name="time-outline" size={28} color={colors.textSecondary} />
        <Text style={styles.stateTitle}>Your session has ended</Text>
        <Text style={styles.stateText}>Please sign in again.</Text>
      </View>
    );
  }
  return (
    <View style={styles.state} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={28} color={colors.textSecondary} />
      <Text style={styles.stateTitle}>Couldn't load this</Text>
      <Text style={styles.stateText}>{failure.message}</Text>
      <GreenButton label="Try again" small onPress={onRetry} style={{ marginTop: 12, alignSelf: "center" }} />
    </View>
  );
}

export function EmptyRows({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.state}>
      <Ionicons name="file-tray-outline" size={28} color={colors.textSecondary} />
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateText}>{body}</Text>
    </View>
  );
}

export function NotFoundState({ what, onBack }: { what: string; onBack: () => void }) {
  return (
    <View style={styles.state}>
      <Ionicons name="search-outline" size={28} color={colors.textSecondary} />
      <Text style={styles.stateTitle}>{what} not found</Text>
      <Text style={styles.stateText}>It doesn't exist, or it isn't part of your organization.</Text>
      <GreenButton label="Back" small variant="outline" onPress={onBack} style={{ marginTop: 12, alignSelf: "center" }} />
    </View>
  );
}

/** Paged list footer: count, "Load more", and a retry for a failed later page. */
export function ListFooter<T>({ p }: { p: PagedState<T> }) {
  return (
    <View style={styles.footer}>
      <Text style={styles.muted}>{pageSummary(p.rows.length, p.total)}</Text>
      {p.moreFailure ? <Text style={styles.errorText}>{p.moreFailure}</Text> : null}
      {p.hasMore ? (
        <GreenButton label={p.loading ? "Loading…" : p.moreFailure ? "Try again" : "Load more"} small variant="outline" disabled={p.loading} onPress={p.loadMore} />
      ) : null}
    </View>
  );
}

/** Whole-list states for a paged list; returns null when rows should render. */
export function PagedStates<T>({ p, emptyTitle, emptyBody }: { p: PagedState<T>; emptyTitle: string; emptyBody: string }) {
  if (p.failure) return <FailureState failure={p.failure} onRetry={p.reload} />;
  if (p.loading && p.rows.length === 0) return <LoadingState />;
  if (!p.loading && p.rows.length === 0) return <EmptyRows title={emptyTitle} body={emptyBody} />;
  return null;
}

// ---------------------------------------------------------------------------
// Controls

export function FilterChips<V extends string>({
  label,
  value,
  options,
  onChange,
  allLabel = "All",
}: {
  label: string;
  value: V | undefined;
  options: readonly { value: V; label: string }[];
  onChange: (v: V | undefined) => void;
  allLabel?: string;
}) {
  const all = [{ value: undefined as V | undefined, label: allLabel }, ...options];
  return (
    <View style={styles.filterGroup} accessibilityLabel={label}>
      <Text style={styles.filterLabel}>{label}</Text>
      <View style={styles.chips}>
        {all.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.label}
              onPress={() => onChange(o.value)}
              style={[styles.chip, selected && styles.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${label}: ${o.label}`}
            >
              <Text style={[styles.chipText, selected && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Search box that applies on submit (Enter / search button), so each keystroke is not a server query. */
export function SearchBox({ placeholder, value, onSubmit }: { placeholder: string; value: string; onSubmit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={16} color={colors.textSecondary} />
      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => onSubmit(text.trim())}
        placeholder={placeholder}
        placeholderTextColor={colors.textLight}
        style={styles.searchInput}
        returnKeyType="search"
        accessibilityLabel={placeholder}
      />
      {text ? (
        <Pressable
          onPress={() => {
            setText("");
            onSubmit("");
          }}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}
        >
          <Ionicons name="close-circle" size={16} color={colors.textLight} />
        </Pressable>
      ) : null}
      <Pressable onPress={() => onSubmit(text.trim())} style={styles.searchBtn} accessibilityRole="button" accessibilityLabel="Search">
        <Text style={styles.searchBtnText}>Search</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Display

export function Section({ title, children, right, style }: { title: string; children: React.ReactNode; right?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.section, style]}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function KeyValue({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvKey}>{k}</Text>
      {typeof v === "string" || typeof v === "number" ? <Text style={styles.kvVal}>{v}</Text> : <View style={{ flex: 1 }}>{v}</View>}
    </View>
  );
}

export function Pill({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "green" | "amber" | "red" | "blue" }) {
  const t = PILL[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <Text style={[styles.pillText, { color: t.fg }]}>{text}</Text>
    </View>
  );
}
const PILL = {
  neutral: { bg: "#EEF1EF", fg: colors.textSecondary },
  green: { bg: colors.greenLight, fg: colors.greenDark },
  amber: { bg: "#FFF3D6", fg: "#8A5A00" },
  red: { bg: "#FDE7E5", fg: "#B3261E" },
  blue: { bg: "#E6EEFB", fg: "#2457B5" },
} as const;

export function StatTile({ label, value, hint, onPress }: { label: string; value: string | number; hint?: string; onPress?: () => void }) {
  const body = (
    <>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.stat, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>
      {body}
    </Pressable>
  ) : (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      {body}
    </View>
  );
}

/** Pressable list row (cards that wrap into columns on wide screens). */
export function RowCard({ onPress, label, children }: { onPress: () => void; label: string; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: "#F4F7F5" }]} accessibilityRole="button" accessibilityLabel={label}>
      {children}
      <Ionicons name="chevron-forward" size={16} color={colors.textLight} />
    </Pressable>
  );
}

export function AuditList({ events, showReport }: { events: AdminAuditEvent[]; showReport?: boolean }) {
  if (events.length === 0) return <Text style={styles.muted}>No history recorded.</Text>;
  return (
    <View>
      {events.map((e) => {
        const details = auditDetails(e.metadata);
        return (
          <View key={e.id} style={styles.auditRow}>
            <Text style={styles.auditTime}>{formatStamp(e.createdAt)}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.auditTitle}>
                {auditEventText(e.eventType)}
                {showReport && e.publicNumber ? <Text style={styles.muted}>{`  · Report #${e.publicNumber}`}</Text> : null}
              </Text>
              <Text style={styles.muted}>
                {ACTOR_ROLE_LABEL[e.actorRole] ?? e.actorRole}
                {e.actorLabel && e.actorLabel !== ACTOR_ROLE_LABEL[e.actorRole] ? ` · ${e.actorLabel}` : ""} · {AUDIT_ENTITY_LABEL[e.entityType] ?? e.entityType}
                {details ? ` · ${details}` : ""}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export const adminStyles = StyleSheet.create({
  muted: { fontSize: 12.5, color: colors.textSecondary },
  cell: { fontSize: 13.5, color: colors.textPrimary },
  cellStrong: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  filters: { gap: 10, marginBottom: 12 },
});

const styles = StyleSheet.create({
  state: { alignItems: "center", paddingVertical: 36, paddingHorizontal: 20, gap: 6 },
  stateTitle: { fontSize: 16, fontWeight: "800", color: colors.textPrimary, marginTop: 4 },
  stateText: { fontSize: 13, color: colors.textSecondary, textAlign: "center", maxWidth: 420 },
  footer: { alignItems: "center", gap: 8, paddingVertical: 14 },
  muted: { fontSize: 12.5, color: colors.textSecondary },
  errorText: { color: "#B3261E", fontSize: 12.5, fontWeight: "600" },
  filterGroup: { gap: 6 },
  filterLabel: { fontSize: 11.5, fontWeight: "800", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.chip, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.greenDark, borderColor: colors.greenDark },
  chipText: { fontSize: 12.5, fontWeight: "700", color: colors.textPrimary },
  chipTextOn: { color: "#fff" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.button, paddingLeft: 12, backgroundColor: colors.white },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: colors.textPrimary },
  searchBtn: { paddingHorizontal: 14, paddingVertical: 10, borderLeftWidth: 1, borderLeftColor: colors.border },
  searchBtnText: { fontWeight: "800", color: colors.greenDark, fontSize: 13 },
  section: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 16 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: colors.textPrimary },
  kv: { flexDirection: "row", gap: 12, paddingVertical: 5 },
  kvKey: { width: 150, fontSize: 12.5, color: colors.textSecondary, fontWeight: "600" },
  kvVal: { flex: 1, fontSize: 13.5, color: colors.textPrimary },
  pill: { alignSelf: "flex-start", borderRadius: radius.chip, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 11.5, fontWeight: "800" },
  stat: { flexGrow: 1, flexBasis: 170, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14 },
  statValue: { fontSize: 24, fontWeight: "800", color: colors.textPrimary },
  statLabel: { fontSize: 12.5, fontWeight: "700", color: colors.textSecondary, marginTop: 2 },
  statHint: { fontSize: 11.5, color: colors.textLight, marginTop: 2 },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  auditRow: { flexDirection: "row", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.borderLight },
  auditTime: { width: 120, fontSize: 12, color: colors.textSecondary, fontVariant: ["tabular-nums"] },
  auditTitle: { fontSize: 13.5, fontWeight: "700", color: colors.textPrimary },
});

export type { DomainError };
