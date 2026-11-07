// 홈 — 모드 선택 + 최근 녹음 목록
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { MODES, getMode } from '../modes';
import type { ModeId } from '../modes';
import { formatDate, formatDuration } from '../storage';
import type { RecordingItem } from '../storage';
import { describe, TONE_COLOR } from '../sync';

interface Props {
  selectedMode: ModeId;
  onSelectMode: (mode: ModeId) => void;
  onStart: () => void;
  recordings: RecordingItem[];
  onOpen: (item: RecordingItem) => void;
  connected: boolean;
  onSettings: () => void;
}

type Filter = ModeId | 'all';

export default function HomeScreen({ selectedMode, onSelectMode, onStart, recordings, onOpen, connected, onSettings }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const mode = getMode(selectedMode);

  const filtered = useMemo(
    () => (filter === 'all' ? recordings : recordings.filter((r) => r.mode === filter)),
    [filter, recordings],
  );

  const header = (
    <View>
      <View style={styles.headRow}>
        <Text style={styles.title}>녹음 노트</Text>
        <Pressable onPress={onSettings} style={styles.conn} hitSlop={6}>
          <View style={[styles.connDot, connected && { backgroundColor: '#16A34A' }]} />
          <Text style={[styles.connText, connected && { color: '#111827' }]}>{connected ? '말씀노트 연결됨' : '말씀노트 연결'}</Text>
        </Pressable>
      </View>
      <Text style={styles.subtitle}>어떤 녹음인가요?</Text>

      <View style={styles.grid}>
        {MODES.map((m) => {
          const active = m.id === selectedMode;
          return (
            <Pressable
              key={m.id}
              onPress={() => onSelectMode(m.id)}
              style={[styles.modeCard, active && { borderColor: m.color, backgroundColor: `${m.color}12` }]}
            >
              <Text style={styles.modeEmoji}>{m.emoji}</Text>
              <Text style={[styles.modeLabel, active && { color: m.color }]}>{m.label}</Text>
              <Text style={styles.modeDesc}>{m.description}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable style={[styles.startBtn, { backgroundColor: mode.color }]} onPress={onStart}>
        <Text style={styles.startText}>● {mode.label} 녹음 시작</Text>
      </Pressable>

      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>녹음 목록</Text>
        <Text style={styles.count}>{filtered.length}개</Text>
      </View>

      <View style={styles.filterRow}>
        {(['all', ...MODES.map((m) => m.id)] as Filter[]).map((f) => {
          const active = f === filter;
          const label = f === 'all' ? '전체' : getMode(f).label;
          return (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <FlatList
      data={filtered}
      keyExtractor={(r) => r.id}
      ListHeaderComponent={header}
      contentContainerStyle={styles.container}
      ListEmptyComponent={<Text style={styles.empty}>아직 녹음이 없어요</Text>}
      renderItem={({ item }) => {
        const m = getMode(item.mode);
        const sync = describe(item, connected);
        return (
          <Pressable style={styles.row} onPress={() => onOpen(item)}>
            <View style={[styles.badge, { backgroundColor: `${m.color}1A` }]}>
              <Text style={[styles.badgeText, { color: m.color }]}>{m.emoji} {m.label}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.rowMeta}>
                {formatDate(item.createdAt)} · {formatDuration(item.durationMs)}
                {item.transcriptStatus === 'done' ? ' · 변환완료' : ''}
              </Text>
              {sync && <Text style={[styles.sync, { color: TONE_COLOR[sync.tone] }]}>{sync.text}</Text>}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '800', color: '#111827' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  conn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#FFFFFF' },
  connDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D1D5DB' },
  connText: { fontSize: 13, fontWeight: '700', color: '#6B7280' },
  sync: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  subtitle: { fontSize: 15, color: '#6B7280', marginTop: 4, marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  modeCard: {
    width: '48%',
    padding: 14,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  modeEmoji: { fontSize: 26 },
  modeLabel: { fontSize: 18, fontWeight: '700', color: '#111827', marginTop: 6 },
  modeDesc: { fontSize: 12, color: '#6B7280', marginTop: 4 },
  startBtn: { marginTop: 20, paddingVertical: 18, borderRadius: 16, alignItems: 'center' },
  startText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 32 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  count: { fontSize: 13, color: '#9CA3AF' },
  filterRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#F3F4F6' },
  chipActive: { backgroundColor: '#111827' },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextActive: { color: '#FFFFFF', fontWeight: '700' },
  empty: { textAlign: 'center', color: '#9CA3AF', marginTop: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    gap: 12,
  },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#111827' },
  rowMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },
});
