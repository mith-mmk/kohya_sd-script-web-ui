import { useT } from '../i18n/LangContext.js';

interface Props {
  datasetDirs: string[];
}

const S: Record<string, React.CSSProperties> = {
  notice: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '24px', color: '#888', fontSize: 13, lineHeight: 1.8 },
  paths: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 },
  path: { color: '#a78bfa', fontFamily: 'monospace', fontSize: 12 },
  instructions: { marginTop: 12, color: '#666', fontSize: 12 },
};

export default function TagEditor({ datasetDirs }: Props) {
  const { t } = useT();
  return (
    <div style={S.notice}>
      <div>{t.tagEditorDatasetDir}</div>
      <div style={S.paths}>
        {datasetDirs.length > 0
          ? datasetDirs.map(datasetDir => <div key={datasetDir} style={S.path}>{datasetDir}</div>)
          : <div style={S.path}>{t.tagEditorNotSet}</div>}
      </div>
      <div style={S.instructions}>
        {t.tagEditorDesc}
        <br /><br />
        {t.tagEditorHint}
      </div>
    </div>
  );
}
