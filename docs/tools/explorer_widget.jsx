const C = { ink: 'var(--cds-text-primary)', quiet: 'var(--cds-text-secondary)', grid: 'var(--cds-chart-grid)', tint: 'var(--cds-chart-reference-tint)', accent: 'var(--cds-chart-categorical-1)', mono: 'ui-monospace, SFMono-Regular, Menlo, monospace' };
const MODES = [{ id: 'name', label: 'Tên & mục đích' }, { id: 'pseudo', label: 'Code thu nhỏ' }, { id: 'code', label: 'Code thật' }];
const chipStyle = (on) => ({ padding: '4px 10px', borderRadius: 999, border: `1px solid ${on ? C.accent : C.grid}`, background: on ? C.tint : 'transparent', color: C.ink, fontSize: 12.5, fontWeight: on ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap' });
const indexRows = (rows) => {
  const list = [];
  const byKey = new Map();
  rows.forEach((r) => {
    const key = `${r.group}|${r.node}`;
    if (!byKey.has(key)) {
      const n = { key, group: r.group, node: r.node, file: '', purpose: '', links: '', pseudo: [], code: [] };
      byKey.set(key, n);
      list.push(n);
    }
    const n = byKey.get(key);
    if (r.kind === 'file') n.file = r.text;
    else if (r.kind === 'purpose') n.purpose = r.text;
    else if (r.kind === 'links') n.links = r.text;
    else if (r.kind === 'pseudo') n.pseudo.push(r);
    else if (r.kind === 'code') n.code.push(r);
  });
  return list;
};
const Line = ({ r, mono }) => <div style={{ display: 'grid', gridTemplateColumns: '38px minmax(0, 1.6fr) minmax(0, 1fr)', gap: 10, padding: '2px 0', borderBottom: `1px dashed ${C.grid}` }}>
  <span style={{ color: C.quiet, fontFamily: C.mono, fontSize: 11, textAlign: 'right' }}>{r.ln}</span>
  <code style={{ fontFamily: C.mono, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: C.ink, opacity: mono ? 1 : 0.95 }}>{r.text}</code>
  <span style={{ color: C.quiet, fontSize: 12 }}>{r.note ? `// ${r.note}` : ''}</span>
</div>;
const Explorer = ({ rows, title }) => {
  const nodes = React.useMemo(() => indexRows(rows), [rows]);
  const groups = React.useMemo(() => [...new Set(nodes.map((n) => n.group))], [nodes]);
  const start = nodes.find((n) => n.node === 'transmit()') || nodes.at(0);
  const [group, setGroup] = React.useState(start?.group);
  const [key, setKey] = React.useState(start?.key);
  const [mode, setMode] = React.useState('pseudo');
  const [q, setQ] = React.useState('');
  const query = q.trim().toLowerCase();
  const shown = query ? nodes.filter((n) => `${n.node} ${n.purpose} ${n.file}`.toLowerCase().includes(query)) : nodes.filter((n) => n.group === group);
  const node = nodes.find((n) => n.key === key) || shown.at(0) || nodes.at(0);
  const pick = (n) => { setKey(n.key); setGroup(n.group); };
  const lines = mode === 'code' ? node.code : node.pseudo;
  return <div style={{ color: C.ink, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <b style={{ fontSize: 14 }}>{title}</b>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Tìm hàm, id, class…' style={{ flex: '1 1 160px', minWidth: 0, padding: '5px 10px', borderRadius: 8, border: `1px solid ${C.grid}`, background: 'transparent', color: C.ink, fontSize: 12.5 }} />
      <div style={{ display: 'flex', gap: 4 }}>{MODES.map((m) => <button key={m.id} onClick={() => setMode(m.id)} style={chipStyle(mode === m.id)}>{m.label}</button>)}</div>
    </div>
    {!query && groups.length > 8 && <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: C.quiet }}>Nhóm<select value={group} onChange={(e) => { const g = e.target.value; setGroup(g); setKey(nodes.find((n) => n.group === g)?.key); }} style={{ flex: '1 1 auto', minWidth: 0, padding: '5px 8px', borderRadius: 8, border: `1px solid ${C.grid}`, background: 'transparent', color: C.ink, fontSize: 12.5 }}>{groups.map((g) => <option key={g} value={g}>{`${g} (${nodes.filter((n) => n.group === g).length})`}</option>)}</select></label>}
    {!query && groups.length <= 8 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{groups.map((g) => <button key={g} onClick={() => { setGroup(g); setKey(nodes.find((n) => n.group === g)?.key); }} style={{ ...chipStyle(g === group), fontSize: 12, color: g === group ? C.ink : C.quiet }}>{g}</button>)}</div>}
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 8, borderBottom: `1px solid ${C.grid}` }}>{shown.map((n) => <button key={n.key} onClick={() => pick(n)} style={{ ...chipStyle(n.key === node.key), fontFamily: C.mono, fontSize: 12 }}>{n.node}</button>)}{query && !shown.length && <span style={{ color: C.quiet }}>Không thấy node nào.</span>}</div>
    {mode === 'name'
      ? <div style={{ display: 'flex', flexDirection: 'column' }}>{shown.map((n) => <div key={n.key} onClick={() => pick(n)} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.8fr)', gap: 12, padding: '6px 4px', borderBottom: `1px dashed ${C.grid}`, cursor: 'pointer', background: n.key === node.key ? C.tint : 'transparent' }}>
          <code style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 600 }}>{n.node}</code>
          <span style={{ fontSize: 12.5 }}>{n.purpose}<span style={{ color: C.quiet }}>{`  · ${n.file}`}</span></span></div>)}</div>
      : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}><code style={{ fontFamily: C.mono, fontSize: 15, fontWeight: 700 }}>{node.node}</code><span style={{ color: C.quiet, fontFamily: C.mono, fontSize: 11.5 }}>{node.file}</span></div>
            <div style={{ marginTop: 4 }}>{node.purpose}</div>
            {node.links && <div style={{ marginTop: 4, color: C.quiet, fontSize: 12 }}><b style={{ color: C.ink }}>Kết nối: </b>{node.links}</div>}
          </div>
          <div style={{ maxHeight: 460, overflowY: 'auto', padding: '6px 8px', borderRadius: 8, background: C.tint }}>
            <div style={{ display: 'grid', gridTemplateColumns: '38px minmax(0, 1.6fr) minmax(0, 1fr)', gap: 10, color: C.quiet, fontSize: 11, paddingBottom: 4 }}><span style={{ textAlign: 'right' }}>{mode === 'code' ? 'dòng' : ''}</span><span>{mode === 'code' ? 'code trong file' : 'code thu nhỏ'}</span><span>chú thích</span></div>
            {lines.map((r, i) => <Line key={i} r={r} mono={mode === 'code'} />)}
            {!lines.length && <span style={{ color: C.quiet }}>Không có dòng nào.</span>}
          </div>
          <span style={{ color: C.quiet, fontSize: 11.5 }}>{mode === 'code' ? `${node.code.length} dòng hiển thị · code lấy thẳng từ ${node.file.split(':').at(0)}` : 'Bấm "Code thật" để xem code đầy đủ có số dòng.'}</span>
        </div>}
  </div>;
};
export default () => <claude.Visualize data-claude-component='__SLUG__' sources={{__SOURCES__}}>{(__ARGS__) => <Explorer title='__TITLE__' rows={__ROWS__} />}</claude.Visualize>;
