// 말씀노트 연결 설정 — Apps Script 웹 앱 주소 · 연결 키 · 자동 전송
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { loadSettings, ping, saveSettings } from '../sync';
import { checkForUpdate, currentVersion, supported as updateSupported } from '../updater';
import type { UpdateInfo } from '../updater';
import UpdateCard from './UpdateCard';

/** 앱 버전 · 업데이트 확인 */
function AppVersion() {
  const [state, setState] = useState<{ busy: boolean; info: UpdateInfo | null; msg: string }>({ busy: false, info: null, msg: '' });
  if (!updateSupported) return null;
  const check = async () => {
    setState({ busy: true, info: null, msg: '' });
    try {
      const info = await checkForUpdate(true);
      setState({ busy: false, info, msg: info ? '' : '최신 버전이에요.' });
    } catch (e) {
      setState({ busy: false, info: null, msg: (e as Error).message });
    }
  };
  return (
    <View style={styles.verBox}>
      <View style={styles.verRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleTitle}>앱 버전 {currentVersion()}</Text>
          <Text style={styles.toggleSub}>새 버전이 나오면 앱을 열 때 자동으로 알려줘요</Text>
        </View>
        <Pressable style={[styles.small, styles.btnGhost, { flex: 0 }]} onPress={check} disabled={state.busy}>
          <Text style={styles.btnGhostText}>{state.busy ? '확인 중…' : '업데이트 확인'}</Text>
        </Pressable>
      </View>
      {state.msg ? <Text style={styles.toggleSub}>{state.msg}</Text> : null}
      {state.info && <UpdateCard info={state.info} />}
    </View>
  );
}

interface Props {
  onBack: () => void;
  onSaved: () => void;
}

type Check = { tone: 'ok' | 'err' | 'busy'; text: string } | null;

export default function SettingsScreen({ onBack, onSaved }: Props) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [auto, setAuto] = useState(true);
  const [connected, setConnected] = useState(false);
  const [check, setCheck] = useState<Check>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      if (!s) return;
      setUrl(s.url);
      setKey(s.key);
      setAuto(s.auto);
      setConnected(true);
    });
  }, []);

  const test = async (): Promise<boolean> => {
    const s = { url: url.trim(), key: key.trim(), auto };
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(s.url)) {
      setCheck({ tone: 'err', text: '주소는 https://script.google.com/… 으로 시작하고 /exec 로 끝나야 해요.' });
      return false;
    }
    if (!s.key) {
      setCheck({ tone: 'err', text: '연결 키를 넣어 주세요. (Apps Script setup 실행 로그에 있어요)' });
      return false;
    }
    setCheck({ tone: 'busy', text: '연결 확인 중…' });
    try {
      const r = await ping(s);
      setCheck(
        r.vito
          ? { tone: 'ok', text: `연결됐어요. 드라이브 '${r.folder}' 폴더 · VITO 받아쓰기 준비 완료` }
          : { tone: 'err', text: '연결은 됐지만 VITO 키가 아직 없어요. Apps Script 맨 위에 키를 넣고 setup을 다시 실행해 주세요.' },
      );
      return true;
    } catch (e) {
      setCheck({ tone: 'err', text: (e as Error).message });
      return false;
    }
  };

  const save = async () => {
    if (await test()) {
      await saveSettings({ url: url.trim(), key: key.trim(), auto });
      onSaved();
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹ 돌아가기</Text>
        </Pressable>
        <Text style={styles.title}>말씀노트 연결</Text>
        <Text style={styles.lede}>
          녹음을 구글 드라이브로 보내면 자동으로 받아쓰고(화자 구분 포함), Claude가 말씀노트에 모드별 지침대로 정리해 넣어요. 웹앱과 같은 주소·키를 쓰면 돼요.
        </Text>

        <Text style={styles.label}>연결 주소 (Apps Script 웹 앱 URL)</Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          style={styles.input}
          placeholder="https://script.google.com/macros/s/…/exec"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <Text style={styles.label}>연결 키</Text>
        <TextInput
          value={key}
          onChangeText={setKey}
          style={styles.input}
          placeholder="setup 실행 로그의 '연결 키'"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <View style={styles.toggle}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleTitle}>저장하면 바로 드라이브로 보내기</Text>
            <Text style={styles.toggleSub}>끄면 녹음 상세 화면에서 직접 보낼 수 있어요</Text>
          </View>
          <Switch value={auto} onValueChange={setAuto} />
        </View>

        {check && (
          <Text style={[styles.check, check.tone === 'ok' && styles.checkOk, check.tone === 'err' && styles.checkErr]}>{check.text}</Text>
        )}

        <View style={styles.row}>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={test}>
            <Text style={styles.btnGhostText}>연결 확인</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnSolid]} onPress={save}>
            <Text style={styles.btnSolidText}>저장</Text>
          </Pressable>
        </View>

        {connected &&
          (!confirmOff ? (
            <Pressable onPress={() => setConfirmOff(true)} style={styles.offBtn}>
              <Text style={styles.offText}>이 기기의 연결 끊기</Text>
            </Pressable>
          ) : (
            <View style={styles.confirm}>
              <Text style={styles.confirmText}>연결을 끊을까요? 녹음은 그대로 남고, 새 녹음만 드라이브로 가지 않아요.</Text>
              <View style={styles.confirmRow}>
                <Pressable onPress={() => setConfirmOff(false)} style={[styles.small, styles.btnGhost]}>
                  <Text style={styles.btnGhostText}>취소</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    await saveSettings(null);
                    onBack();
                  }}
                  style={[styles.small, { backgroundColor: '#DC2626' }]}
                >
                  <Text style={styles.btnSolidText}>끊기</Text>
                </Pressable>
              </View>
            </View>
          ))}

        <Text style={styles.foot}>연결 주소와 키는 이 휴대폰에만 저장돼요.</Text>

        <AppVersion />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48, gap: 6 },
  back: { fontSize: 16, color: '#2563EB', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '800', color: '#111827' },
  lede: { fontSize: 14, color: '#6B7280', lineHeight: 21, marginTop: 4, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginTop: 14, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F3F4F6', borderRadius: 14, padding: 14, marginTop: 16 },
  toggleTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  toggleSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  check: { marginTop: 14, padding: 12, borderRadius: 10, backgroundColor: '#F3F4F6', color: '#374151', fontSize: 13, lineHeight: 19 },
  checkOk: { backgroundColor: '#ECFDF3', color: '#15803D' },
  checkErr: { backgroundColor: '#FEF2F2', color: '#DC2626' },
  row: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  btnGhost: { flex: 1, backgroundColor: '#F3F4F6' },
  btnGhostText: { color: '#111827', fontWeight: '700', fontSize: 15 },
  btnSolid: { flex: 2, backgroundColor: '#2563EB' },
  btnSolidText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  offBtn: { alignItems: 'center', padding: 12, marginTop: 18 },
  offText: { color: '#DC2626', fontSize: 14 },
  confirm: { marginTop: 18, padding: 14, borderRadius: 14, backgroundColor: '#FEF2F2', gap: 10 },
  confirmText: { fontSize: 14, color: '#111827', lineHeight: 20 },
  confirmRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  small: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center' },
  foot: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginTop: 24 },
  verBox: { marginTop: 28, paddingTop: 18, borderTopWidth: 1, borderTopColor: '#E5E7EB', gap: 10 },
  verRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
