// 녹음 화면 — 시작/일시정지/재개/종료 + 음량 파형 + 제목 입력 후 저장
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { ENABLE_BACKGROUND_RECORDING, VOICE_RECORDING, getMode } from '../modes';
import type { ModeId } from '../modes';
import { formatDate, formatDuration, newId } from '../storage';
import type { RecordingItem } from '../storage';

interface Props {
  modeId: ModeId;
  onSaved: (item: RecordingItem) => void;
  onCancel: () => void;
}

type Phase = 'preparing' | 'recording' | 'paused' | 'naming' | 'error';

const BAR_COUNT = 40;

const KEEP_AWAKE_TAG = 'voice-note-recording';

export default function RecordScreen({ modeId, onSaved, onCancel }: Props) {
  const mode = getMode(modeId);
  const recorder = useAudioRecorder(VOICE_RECORDING);
  const state = useAudioRecorderState(recorder, 150);

  const [phase, setPhase] = useState<Phase>('preparing');
  const [levels, setLevels] = useState<number[]>(Array(BAR_COUNT).fill(0.05));
  const [title, setTitle] = useState('');
  const finalRef = useRef<{ uri: string; durationMs: number } | null>(null);

  // 화면 진입 즉시 녹음 시작
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await recorder.prepareToRecordAsync();
        if (cancelled) return;
        recorder.record();
        setPhase('recording');
      } catch (e) {
        setPhase('error');
        Alert.alert('녹음을 시작할 수 없어요', String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 백그라운드 녹음이 꺼져 있을 때만 화면 꺼짐 방지 (켜져 있으면 화면을 꺼도 녹음 계속 → 배터리 절약)
  useEffect(() => {
    if (ENABLE_BACKGROUND_RECORDING) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, []);

  // 앱으로 돌아왔을 때 녹음 상태 점검 — 전화·알람 등으로 녹음이 끊겼으면 일시정지로 전환
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || phaseRef.current !== 'recording') return;
      if (!recorder.getStatus().isRecording) {
        setPhase('paused');
        Alert.alert(
          '녹음이 일시정지됐어요',
          '전화나 다른 앱의 소리 때문에 녹음이 멈췄어요. ▶ 버튼을 눌러 이어서 녹음하세요.',
        );
      }
    });
    return () => sub.remove();
  }, [recorder]);

  // 음량(dB) → 파형 막대
  useEffect(() => {
    if (phase !== 'recording') return;
    const db = state.metering ?? -60;
    const level = Math.max(0.05, Math.min(1, (db + 60) / 60));
    setLevels((prev) => [...prev.slice(1), level]);
  }, [state.durationMillis, state.metering, phase]);

  // 안드로이드 뒤로가기 → 녹음 중이면 확인
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmDiscard();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const togglePause = () => {
    if (phase === 'recording') {
      recorder.pause();
      setPhase('paused');
    } else if (phase === 'paused') {
      recorder.record();
      setPhase('recording');
    }
  };

  const stop = async () => {
    const durationMs = state.durationMillis;
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) {
      Alert.alert('저장 실패', '녹음 파일을 찾을 수 없어요.');
      setPhase('error');
      return;
    }
    finalRef.current = { uri, durationMs };
    setTitle(`${mode.label} ${formatDate(new Date().toISOString())}`);
    setPhase('naming');
  };

  const save = () => {
    const fin = finalRef.current;
    if (!fin) return;
    onSaved({
      id: newId(),
      mode: modeId,
      title: title.trim() || `${mode.label} 녹음`,
      uri: fin.uri,
      durationMs: fin.durationMs,
      createdAt: new Date().toISOString(),
      transcriptStatus: 'none',
    });
  };

  const confirmDiscard = () => {
    if (phase === 'error') {
      onCancel();
      return;
    }
    Alert.alert('녹음을 버릴까요?', '지금까지 녹음한 내용이 저장되지 않아요.', [
      { text: '계속하기', style: 'cancel' },
      {
        text: '버리기',
        style: 'destructive',
        onPress: async () => {
          if (phase === 'recording' || phase === 'paused') {
            try {
              await recorder.stop();
            } catch {
              /* 이미 멈춘 경우 무시 */
            }
          }
          onCancel();
        },
      },
    ]);
  };

  // ---- 저장 단계: 제목 입력 ----
  if (phase === 'naming') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={[styles.modeTag, { color: mode.color }]}>{mode.emoji} {mode.label}</Text>
        <Text style={styles.doneTitle}>녹음 완료</Text>
        <Text style={styles.doneTime}>{formatDuration(finalRef.current?.durationMs ?? 0)}</Text>

        <Text style={styles.inputLabel}>
          {modeId === 'consult' ? '고객명 / 상담 제목' : modeId === 'sermon' ? '말씀 제목 / 본문' : '제목'}
        </Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          style={styles.input}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={save}
        />

        <Pressable style={[styles.primaryBtn, { backgroundColor: mode.color }]} onPress={save}>
          <Text style={styles.primaryText}>저장</Text>
        </Pressable>
        <Pressable style={styles.textBtn} onPress={confirmDiscard}>
          <Text style={styles.textBtnLabel}>버리기</Text>
        </Pressable>
      </KeyboardAvoidingView>
    );
  }

  // ---- 녹음 단계 ----
  const isLive = phase === 'recording';
  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Pressable onPress={confirmDiscard} hitSlop={12}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
        <Text style={[styles.modeTag, { color: mode.color }]}>{mode.emoji} {mode.label} 모드</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.center}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: isLive ? '#EF4444' : '#9CA3AF' }]} />
          <Text style={styles.statusText}>
            {phase === 'preparing' ? '준비 중…' : isLive ? '녹음 중' : phase === 'paused' ? '일시정지' : '오류'}
          </Text>
        </View>

        <Text style={styles.timer}>{formatDuration(state.durationMillis)}</Text>

        <View style={styles.wave}>
          {levels.map((lv, i) => (
            <View
              key={i}
              style={[
                styles.bar,
                { height: 8 + lv * 72, backgroundColor: isLive ? mode.color : '#D1D5DB' },
              ]}
            />
          ))}
        </View>

        <Text style={styles.hint}>
          {mode.diarization ? '변환 시 화자별로 구분돼요' : '1인 화자로 변환돼요'}
        </Text>
        <Text style={styles.hint2}>
          {ENABLE_BACKGROUND_RECORDING
            ? '🔒 화면을 꺼도 녹음이 계속돼요'
            : '화면을 켜둔 상태로 녹음해 주세요'}
        </Text>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={[styles.roundBtn, styles.pauseBtn]}
          onPress={togglePause}
          disabled={phase !== 'recording' && phase !== 'paused'}
        >
          <Text style={styles.pauseIcon}>{phase === 'paused' ? '▶' : '❚❚'}</Text>
        </Pressable>
        <Pressable
          style={[styles.roundBtn, styles.stopBtn]}
          onPress={stop}
          disabled={phase !== 'recording' && phase !== 'paused'}
        >
          <View style={styles.stopSquare} />
        </Pressable>
      </View>
      <Text style={styles.controlsHint}>일시정지 · 종료</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#FFFFFF' },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  close: { fontSize: 22, color: '#6B7280' },
  modeTag: { fontSize: 16, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 15, color: '#374151', fontWeight: '600' },
  timer: { fontSize: 64, fontWeight: '200', color: '#111827', marginTop: 12, fontVariant: ['tabular-nums'] },
  wave: { flexDirection: 'row', alignItems: 'center', height: 90, gap: 3, marginTop: 28 },
  bar: { width: 4, borderRadius: 2 },
  hint: { fontSize: 13, color: '#9CA3AF', marginTop: 24 },
  hint2: { fontSize: 13, color: '#6B7280', marginTop: 6, fontWeight: '600' },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 40, marginBottom: 8 },
  roundBtn: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  pauseBtn: { backgroundColor: '#F3F4F6' },
  pauseIcon: { fontSize: 22, color: '#111827', fontWeight: '800' },
  stopBtn: { backgroundColor: '#EF4444' },
  stopSquare: { width: 26, height: 26, borderRadius: 4, backgroundColor: '#FFFFFF' },
  controlsHint: { textAlign: 'center', color: '#9CA3AF', fontSize: 12, marginBottom: 16 },
  doneTitle: { fontSize: 26, fontWeight: '800', color: '#111827', marginTop: 32 },
  doneTime: { fontSize: 16, color: '#6B7280', marginTop: 4 },
  inputLabel: { fontSize: 14, color: '#374151', marginTop: 32, marginBottom: 8, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
  },
  primaryBtn: { marginTop: 24, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  textBtn: { marginTop: 12, alignItems: 'center', padding: 10 },
  textBtnLabel: { color: '#EF4444', fontSize: 15 },
});
