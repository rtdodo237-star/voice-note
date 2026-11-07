// 새 버전 안내 카드 — 홈 배너와 설정 화면에서 함께 사용
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { currentVersion, downloadAndInstall, formatMB } from '../updater';
import type { UpdateInfo } from '../updater';

interface Props {
  info: UpdateInfo;
  onDismiss?: () => void;
}

export default function UpdateCard({ info, onDismiss }: Props) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  const start = async () => {
    setError(null);
    setProgress(0);
    try {
      await downloadAndInstall(info, setProgress);
      setOpened(true);
    } catch (e) {
      setError('업데이트를 내려받지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요. (' + (e as Error).message + ')');
    } finally {
      setProgress(null);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>새 버전 {info.version}이 있어요</Text>
          <Text style={styles.sub}>
            지금 {currentVersion() || '이전 버전'} · {formatMB(info.size)} · 녹음은 그대로 남아요
          </Text>
        </View>
        {onDismiss && progress === null && (
          <Pressable onPress={onDismiss} hitSlop={10}>
            <Text style={styles.later}>나중에</Text>
          </Pressable>
        )}
      </View>

      {progress !== null ? (
        <View style={{ gap: 6 }}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <Text style={styles.sub}>{progress < 1 ? `내려받는 중 ${Math.round(progress * 100)}%` : '설치 화면을 여는 중…'}</Text>
        </View>
      ) : (
        <Pressable style={styles.btn} onPress={start}>
          <Text style={styles.btnText}>{opened ? '설치 화면 다시 열기' : '업데이트'}</Text>
        </Pressable>
      )}

      {opened && progress === null && (
        <Text style={styles.hint}>
          설치 화면에서 <Text style={styles.bold}>업데이트</Text>를 눌러 주세요. 처음 한 번은 '이 출처 허용'을 켜야 할 수 있어요.
        </Text>
      )}
      {error && <Text style={styles.err}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#EFF6FF', borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, borderColor: '#BFDBFE' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { fontSize: 15, fontWeight: '800', color: '#1E3A8A' },
  sub: { fontSize: 12, color: '#475569', marginTop: 2 },
  later: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  btn: { backgroundColor: '#2563EB', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  track: { height: 6, borderRadius: 3, backgroundColor: '#DBEAFE', overflow: 'hidden' },
  fill: { height: 6, backgroundColor: '#2563EB' },
  hint: { fontSize: 12, color: '#334155', lineHeight: 18 },
  bold: { fontWeight: '800' },
  err: { fontSize: 12, color: '#DC2626', lineHeight: 18 },
});
