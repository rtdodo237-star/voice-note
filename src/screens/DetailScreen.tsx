// 녹음 상세 — 재생 + 정보 + 삭제 (+ Phase 1에서 '텍스트 변환' 연결)
import React, { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { getMode } from '../modes';
import { formatDate, formatDuration } from '../storage';
import type { RecordingItem } from '../storage';
import { NOTE_APP_URL, refreshStatus, sendRecording } from '../sync';

interface Props {
  item: RecordingItem;
  onBack: () => void;
  onDelete: (id: string) => void;
  connected: boolean;
  onSettings: () => void;
  /** 저장소가 바뀌었을 때 목록 다시 읽기 */
  onChanged: () => void;
}

const RATES = [1, 1.25, 1.5, 2];

/* ---------- 말씀노트 연결 상태 ---------- */
function SyncPanel({ item, color, connected, onSettings, onChanged }: { item: RecordingItem; color: string; connected: boolean; onSettings: () => void; onChanged: () => void }) {
  const [progress, setProgress] = useState<number | null>(null);

  // 화면을 보는 동안 받아쓰기 상태를 30초마다 확인
  useEffect(() => {
    if (!connected || item.upload?.status !== 'done') return;
    const check = () => refreshStatus().then((ch) => ch && onChanged()).catch(() => {});
    check();
    const iv = setInterval(check, 30000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.upload?.status, item.remote?.status, connected]);

  if (!connected) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>말씀노트 연결</Text>
        <Text style={styles.cardLine}>연결하면 이 녹음을 자동으로 받아써서 말씀노트에 정리해 넣어요.</Text>
        <Pressable style={[styles.convertBtn, { borderColor: color }]} onPress={onSettings}>
          <Text style={[styles.convertText, { color }]}>연결 설정하기</Text>
        </Pressable>
      </View>
    );
  }

  const up = item.upload?.status;
  const rs = item.remote?.status;
  const send = async () => {
    setProgress(0);
    try {
      await sendRecording(item.id, (r) => setProgress(r));
    } catch (e) {
      Alert.alert('전송 실패', (e as Error).message);
    } finally {
      setProgress(null);
      onChanged();
    }
  };
  const step = (state: 'ok' | 'now' | 'err' | '', title: string, sub: string) => (
    <View style={styles.step}>
      <View style={[styles.stepDot, state === 'ok' && styles.dotOk, state === 'err' && styles.dotErr, state === 'now' && { borderColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={[styles.stepSub, state === 'err' && { color: '#DC2626' }]}>{sub}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>말씀노트 연결</Text>
      {step(
        up === 'done' ? 'ok' : up === 'error' ? 'err' : 'now',
        '드라이브 전송',
        up === 'done' ? '완료' : progress !== null ? `보내는 중 ${Math.round(progress * 100)}%` : up === 'uploading' ? '보내는 중' : up === 'error' ? item.upload?.error || '실패' : '대기',
      )}
      {step(
        rs === 'done' ? 'ok' : rs === 'failed' ? 'err' : up === 'done' ? 'now' : '',
        '받아쓰기 (VITO)',
        rs === 'done' ? '완료' : rs === 'failed' ? item.remote?.error || '실패' : rs === 'submitted' ? '받아쓰는 중 · 녹음 길이에 따라 수 분' : up === 'done' ? '5분 안에 시작' : '전송 후 시작',
      )}
      {step(rs === 'done' ? 'now' : '', '말씀노트 등록 · AI 정리', rs === 'done' ? '1시간 안에 자동 등록돼요' : '받아쓰기 후 자동')}
      {progress !== null && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: color }]} />
        </View>
      )}
      {up !== 'done' && up !== 'uploading' && progress === null && (
        <Pressable style={[styles.sendBtn, { backgroundColor: color }]} onPress={send}>
          <Text style={styles.sendText}>{up === 'error' ? '다시 보내기' : '드라이브로 보내기'}</Text>
        </Pressable>
      )}
      {rs === 'done' && (
        <Pressable style={[styles.convertBtn, { borderColor: color }]} onPress={() => Linking.openURL(NOTE_APP_URL)}>
          <Text style={[styles.convertText, { color }]}>말씀노트 열기</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function DetailScreen({ item, onBack, onDelete, connected, onSettings, onChanged }: Props) {
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

      {/* 말씀노트 연결: 드라이브 전송 → 받아쓰기 → 말씀노트 등록 */}
      <SyncPanel item={item} color={mode.color} connected={connected} onSettings={onSettings} onChanged={onChanged} />

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
  step: { flexDirection: 'row', gap: 10, marginTop: 10 },
  stepDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#D1D5DB', marginTop: 4 },
  dotOk: { backgroundColor: '#16A34A', borderColor: '#16A34A' },
  dotErr: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
  stepTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  stepSub: { fontSize: 13, color: '#6B7280', marginTop: 1 },
  sendBtn: { marginTop: 14, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  sendText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  convertText: { fontSize: 15, fontWeight: '800' },
  transcript: { fontSize: 14, color: '#111827', lineHeight: 21 },
  deleteBtn: { marginTop: 32, alignItems: 'center', padding: 10 },
  deleteText: { color: '#EF4444', fontSize: 14 },
});
