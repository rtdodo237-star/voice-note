// 녹음 상세 — 재생 + 정보 + 삭제 (+ Phase 1에서 '텍스트 변환' 연결)
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { getMode } from '../modes';
import { formatDate, formatDuration } from '../storage';
import type { RecordingItem } from '../storage';

interface Props {
  item: RecordingItem;
  onBack: () => void;
  onDelete: (id: string) => void;
}

const RATES = [1, 1.25, 1.5, 2];

export default function DetailScreen({ item, onBack, onDelete }: Props) {
  const mode = getMode(item.mode);
  const player = useAudioPlayer({ uri: item.uri });
  const status = useAudioPlayerStatus(player);
  const [rate, setRate] = React.useState(1);

  const togglePlay = () => {
    if (status.playing) {
      player.pause();
    } else {
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.2)) {
        player.seekTo(0);
      }
      player.play();
    }
  };

  const skip = (sec: number) => {
    const t = Math.max(0, Math.min(status.duration || 0, status.currentTime + sec));
    player.seekTo(t);
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    player.setPlaybackRate(next);
    setRate(next);
  };

  const confirmDelete = () => {
    Alert.alert('녹음을 삭제할까요?', item.title, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => onDelete(item.id) },
    ]);
  };

  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={styles.back}>‹ 목록</Text>
      </Pressable>

      <Text style={[styles.modeTag, { color: mode.color }]}>{mode.emoji} {mode.label}</Text>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.meta}>
        {formatDate(item.createdAt)} · {formatDuration(item.durationMs)}
      </Text>

      {/* 재생기 */}
      <View style={styles.player}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: mode.color }]} />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.time}>{formatDuration(status.currentTime * 1000)}</Text>
          <Text style={styles.time}>{formatDuration((status.duration || item.durationMs / 1000) * 1000)}</Text>
        </View>
        <View style={styles.playRow}>
          <Pressable onPress={() => skip(-15)} style={styles.smallBtn}>
            <Text style={styles.smallText}>-15초</Text>
          </Pressable>
          <Pressable onPress={togglePlay} style={[styles.playBtn, { backgroundColor: mode.color }]}>
            <Text style={styles.playIcon}>{status.playing ? '❚❚' : '▶'}</Text>
          </Pressable>
          <Pressable onPress={() => skip(15)} style={styles.smallBtn}>
            <Text style={styles.smallText}>+15초</Text>
          </Pressable>
        </View>
        <Pressable onPress={cycleRate} style={styles.rateBtn}>
          <Text style={styles.rateText}>속도 {rate}x</Text>
        </Pressable>
      </View>

      {/* 모드 정보 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>변환 설정 (이 모드)</Text>
        <Text style={styles.cardLine}>화자분리: {mode.diarization ? '사용' : '사용 안 함 (1인)'}</Text>
        <Text style={styles.cardLine}>정리 항목: {mode.summarySections.join(' · ')}</Text>
        <Text style={styles.cardLine}>저장 위치(RAG): {mode.ragCollection}</Text>
      </View>

      {/* 텍스트 변환 — Phase 1에서 STT 엔진 연결 */}
      <Pressable
        style={[styles.convertBtn, { borderColor: mode.color }]}
        onPress={() =>
          Alert.alert('텍스트 변환', '다음 단계(Phase 1)에서 STT 엔진(VITO/CLOVA)을 연결하면 활성화돼요.')
        }
      >
        <Text style={[styles.convertText, { color: mode.color }]}>📝 텍스트로 변환 (준비 중)</Text>
      </Pressable>

      {item.transcriptMd ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>변환 결과</Text>
          <Text selectable style={styles.transcript}>{item.transcriptMd}</Text>
        </View>
      ) : null}

      <Pressable onPress={confirmDelete} style={styles.deleteBtn}>
        <Text style={styles.deleteText}>녹음 삭제</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48 },
  back: { fontSize: 16, color: '#2563EB', marginBottom: 16 },
  modeTag: { fontSize: 14, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '800', color: '#111827', marginTop: 4 },
  meta: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  player: { marginTop: 24, padding: 16, borderRadius: 16, backgroundColor: '#F9FAFB' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#E5E7EB', overflow: 'hidden' },
  progressFill: { height: 6 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  time: { fontSize: 12, color: '#6B7280', fontVariant: ['tabular-nums'] },
  playRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28, marginTop: 12 },
  smallBtn: { padding: 8 },
  smallText: { fontSize: 14, color: '#374151', fontWeight: '600' },
  playBtn: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  playIcon: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
  rateBtn: { alignSelf: 'center', marginTop: 10, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: '#E5E7EB' },
  rateText: { fontSize: 12, color: '#374151', fontWeight: '700' },
  card: { marginTop: 16, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 8 },
  cardLine: { fontSize: 13, color: '#374151', marginTop: 2 },
  convertBtn: { marginTop: 16, paddingVertical: 14, borderRadius: 14, borderWidth: 2, alignItems: 'center' },
  convertText: { fontSize: 15, fontWeight: '800' },
  transcript: { fontSize: 14, color: '#111827', lineHeight: 21 },
  deleteBtn: { marginTop: 32, alignItems: 'center', padding: 10 },
  deleteText: { color: '#EF4444', fontSize: 14 },
});
