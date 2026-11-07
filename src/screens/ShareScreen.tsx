// 받아쓴 글 가져오기 — 갤럭시 녹음 앱(Galaxy AI 텍스트 변환)·삼성 노트 등에서 '공유'로 받거나 붙여넣은 글을
// 녹취록 md 로 정리해 드라이브 '녹음노트/2_녹취'에 저장 → Claude가 말씀노트에 모드별로 정리해 넣음
import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MODES, getMode } from '../modes';
import type { ModeId } from '../modes';
import { buildMarkdown, cleanTranscript, guessTitle } from '../transcript';
import { sendTranscript } from '../sync';
import { newId } from '../storage';

interface Props {
  initialText: string;
  metaTitle?: string | null;
  defaultMode: ModeId;
  connected: boolean;
  onSettings: () => void;
  onDone: (msg: string) => void;
  onCancel: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
function parseWhen(s: string): Date | null {
  const m = s.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 12), Number(m[5] || 0));
  return isNaN(d.getTime()) ? null : d;
}

export default function ShareScreen({ initialText, metaTitle, defaultMode, connected, onSettings, onDone, onCancel }: Props) {
  const [raw, setRaw] = useState(initialText);
  const [mode, setMode] = useState<ModeId>(defaultMode);
  const [title, setTitle] = useState(() => guessTitle(initialText, metaTitle));
  const [when, setWhen] = useState(() => fmt(new Date()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const cleaned = useMemo(() => cleanTranscript(raw), [raw]);
  const m = getMode(mode);
  const chars = raw.trim().length;

  const send = async () => {
    setErr('');
    if (chars < 10) return setErr('받아쓴 글이 비어 있어요. 갤럭시 녹음 앱에서 공유하거나 여기에 붙여넣어 주세요.');
    const d = parseWhen(when);
    if (!d) return setErr('녹음 날짜는 2026-11-08 14:30 처럼 적어 주세요.');
    setBusy(true);
    try {
      const md = buildMarkdown({ id: newId(), mode, title: title.trim(), recordedAt: d, cleaned, source: 'Galaxy AI (공유)' });
      await sendTranscript(md.name, md.text);
      onDone(`드라이브에 저장했어요 · 1시간 안에 말씀노트 '${m.label}'에 정리돼요`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Pressable onPress={onCancel} hitSlop={12}>
          <Text style={styles.back}>‹ 돌아가기</Text>
        </Pressable>
        <Text style={styles.title}>받아쓴 글 가져오기</Text>
        <Text style={styles.lede}>
          갤럭시 녹음 앱에서 '텍스트 변환' 후 공유 → 녹음 노트를 고르면 여기로 와요. 분류만 고르고 보내면 말씀노트에 정리돼요.
        </Text>

        {!connected && (
          <Pressable style={styles.warn} onPress={onSettings}>
            <Text style={styles.warnText}>말씀노트 연결이 아직 안 돼 있어요. 눌러서 주소와 키를 먼저 넣어 주세요 ›</Text>
          </Pressable>
        )}

        <Text style={styles.label}>분류</Text>
        <View style={styles.modes}>
          {MODES.map((x) => {
            const on = x.id === mode;
            return (
              <Pressable key={x.id} onPress={() => setMode(x.id)} style={[styles.chip, on && { borderColor: x.color, backgroundColor: `${x.color}14` }]}>
                <Text style={[styles.chipText, on && { color: x.color }]}>
                  {x.emoji} {x.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>제목</Text>
        <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder={`${m.label} 녹음`} placeholderTextColor="#9CA3AF" />

        <Text style={styles.label}>녹음 날짜</Text>
        <TextInput value={when} onChangeText={setWhen} style={styles.input} placeholder="2026-11-08 14:30" placeholderTextColor="#9CA3AF" />

        <View style={styles.textHead}>
          <Text style={styles.label}>받아쓴 글</Text>
          <Text style={styles.meta}>
            {chars.toLocaleString()}자{cleaned.structured ? ` · 화자 ${cleaned.speakers}명 인식` : ''}
          </Text>
        </View>
        <TextInput
          value={raw}
          onChangeText={setRaw}
          style={[styles.input, styles.area]}
          multiline
          textAlignVertical="top"
          placeholder="여기에 받아쓴 글을 붙여넣어도 돼요"
          placeholderTextColor="#9CA3AF"
        />

        {err ? <Text style={styles.err}>{err}</Text> : null}

        <Pressable style={[styles.send, { backgroundColor: m.color }, busy && { opacity: 0.6 }]} onPress={send} disabled={busy}>
          <Text style={styles.sendText}>{busy ? '보내는 중…' : `${m.emoji} ${m.label}(으)로 말씀노트에 보내기`}</Text>
        </Pressable>
        <Text style={styles.foot}>드라이브 '녹음노트/2_녹취' 폴더에 md 파일로 저장돼요. 받아쓰기 비용은 들지 않아요.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48, gap: 6 },
  back: { fontSize: 16, color: '#2563EB', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '800', color: '#111827' },
  lede: { fontSize: 14, color: '#6B7280', lineHeight: 21, marginTop: 4, marginBottom: 4 },
  warn: { backgroundColor: '#FEF2F2', borderRadius: 12, padding: 12, marginTop: 8 },
  warnText: { color: '#DC2626', fontSize: 13, lineHeight: 19 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginTop: 14, marginBottom: 6 },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  chipText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827' },
  area: { minHeight: 220, maxHeight: 420, fontSize: 14, lineHeight: 20 },
  textHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  meta: { fontSize: 12, color: '#6B7280', marginBottom: 6 },
  err: { marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: '#FEF2F2', color: '#DC2626', fontSize: 13, lineHeight: 19 },
  send: { marginTop: 18, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  sendText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  foot: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginTop: 12, lineHeight: 18 },
});
