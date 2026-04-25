import { useT } from '../i18n/LangContext.js';

interface Props {
  datasetDir: string;
}

const S: Record<string, React.CSSProperties> = {
  notice: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '24px', color: '#888', fontSize: 13, lineHeight: 1.8 },
  path: { color: '#a78bfa', fontFamily: 'monospace', fontSize: 12 },
  instructions: { marginTop: 12, color: '#666', fontSize: 12 },
};

export default function TagEditor({ datasetDir }: Props) {
  const { t } = useT();
  return (
    <div style={S.notice}>
      <div>{t.tagEditorDatasetDir}</div>
      <div style={S.path}>{datasetDir || t.tagEditorNotSet}</div>
      <div style={S.instructions}>
        {t.tagEditorDesc}
        <br /><br />
        {t.tagEditorHint}
      </div>
    </div>
  );
}
