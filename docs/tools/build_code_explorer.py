#!/usr/bin/env python3
"""Sinh dữ liệu cho "Trình xem code" trong tài liệu Claude Docs (tab HTML, CSS, JS).

Chạy:  python3 docs/tools/build_code_explorer.py
Ra:    docs/tools/out/html.csv, css.csv, js-app.csv, js-core.csv, js-ui.csv

Mỗi dòng CSV: group, node, kind, ln, text, note
  kind = name | file | purpose | links | pseudo | code
Code lấy thẳng từ file nguồn, nên chạy lại script sau mỗi lần sửa code rồi tải CSV mới lên
tài liệu (xem CLAUDE.md, mục "Tài liệu code").
Ghi chú tay (mục đích, pseudo code, chú thích dòng) nằm trong docs/tools/code_notes.py.
"""
import csv
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.dirname(__file__))
from code_notes import (  # noqa: E402
    CSS_GROUPS, CSS_LINE_NOTES, CSS_PURPOSE, HTML_LINE_NOTES, HTML_NODES, JS_FILES,
    JS_LINE_NOTES, JS_NOTES, SHORT_PURPOSE, STATIC_NODES
)

OUT = os.path.join(ROOT, 'docs', 'tools', 'out')
MAX_CODE = 60   # dòng code tối đa mỗi node
MAX_PSEUDO = 40


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read().split('\n')


def note_for(line, table):
    for key, note in table:
        if key in line:
            return note
    return ''


def short(text, n=86):
    text = text.strip()
    return text if len(text) <= n else text[: n - 1] + '…'


class Rows:
    def __init__(self):
        self.rows = []

    def add(self, group, node, kind, text='', note='', ln=''):
        self.rows.append([group, node, kind, str(ln), text, note])

    def node(self, group, node, file, purpose, links, pseudo, code):
        self.add(group, node, 'name', node)
        self.add(group, node, 'file', file)
        self.add(group, node, 'purpose', purpose)
        if links:
            self.add(group, node, 'links', links)
        for text, note in pseudo[:MAX_PSEUDO]:
            self.add(group, node, 'pseudo', text, note)
        for ln, text, note in code[:MAX_CODE]:
            self.add(group, node, 'code', text, note, ln)
        if len(code) > MAX_CODE:
            self.add(group, node, 'code', f'… còn {len(code) - MAX_CODE} dòng — xem {file}', '', '')

    def split(self, limit=1900):
        """Chia theo node để mỗi phần <= limit dòng (giới hạn 2000 dòng / nguồn của widget)."""
        parts, cur, key = [], [], None
        for row in self.rows:
            if row[2] == 'name' and len(cur) > limit - 120:
                parts.append(cur)
                cur = []
            cur.append(row)
        parts.append(cur)
        out = []
        for p in parts:
            r = Rows()
            r.rows = p
            out.append(r)
        return out

    def write(self, name):
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, name)
        with open(path, 'w', newline='', encoding='utf-8') as f:
            w = csv.writer(f)
            w.writerow(['group', 'node', 'kind', 'ln', 'text', 'note'])
            w.writerows(self.rows)
        return path, len(self.rows)


# ------------------------------------------------------------------ HTML
TAG_RE = re.compile(r'<([a-zA-Z0-9]+)([^>]*)>')


def html_outline(lines, extra=()):
    """Code thu nhỏ: chỉ giữ thẻ + #id + .class đầu tiên, thụt lề theo độ sâu thật (ngăn xếp thẻ)."""
    out = []
    stack = []
    void = {'meta', 'link', 'input', 'br', 'img', 'source', 'path', 'circle', 'rect', 'line'}
    keep = {'section', 'dialog', 'form', 'nav', 'header', 'main', 'svg', 'canvas', 'table', 'details', 'select',
            'textarea', 'script', 'ul', 'ol', 'head', 'body', 'input', 'button', 'h1', 'h2', 'h3', 'output', 'summary',
            'label', 'code', 'pre', 'title', 'meta', 'link'}
    for line in lines:
        s = line.strip()
        if not s or s.startswith('<!--'):
            continue
        for m in re.finditer(r'<(/?)([a-zA-Z0-9]+)([^>]*)>', s):
            closing, tag, attrs = m.group(1), m.group(2), m.group(3)
            if closing:
                if tag in stack:
                    while stack and stack.pop() != tag:
                        pass
                continue
            depth = len(stack)
            ident = re.search(r'\bid="([^"]+)"', attrs)
            cls = re.search(r'\bclass="([^"]+)"', attrs)
            data = re.search(r'\b(data-[a-z-]+)="([^"]*)"', attrs)
            label = tag + ('#' + ident.group(1) if ident else '') + ('.' + cls.group(1).split()[0] if cls else '')
            if data and not ident:
                label += f'[{data.group(1)}="{data.group(2)}"]'
            if tag in ('meta', 'link'):
                kv = re.search(r'\b(name|property|rel|charset)="?([^" ]+)', attrs)
                label += f' {kv.group(1)}={kv.group(2)}' if kv else ''
            inner = re.sub(r'<[^>]+>', ' ', s[m.end():]).strip()
            if inner and tag in ('button', 'h1', 'h2', 'h3', 'summary', 'title', 'label'):
                label += f'  "{short(inner.split("  ")[0], 32)}"'
            if ident or cls or tag in keep:
                out.append(('  ' * min(depth, 7) + label, note_for(m.group(0), list(extra) + HTML_LINE_NOTES)))
            if tag not in void and not attrs.rstrip().endswith('/'):
                stack.append(tag)
    return out


def build_html():
    lines = read('index.html')
    rows = Rows()
    for spec in HTML_NODES:
        start = next(i for i, l in enumerate(lines) if spec['start'] in l)
        end = next(i for i in range(start, len(lines)) if spec['end'] in lines[i])
        block = lines[start:end + 1]
        code = [(start + 1 + k, l.rstrip(), note_for(l, spec.get('notes', []) + HTML_LINE_NOTES)) for k, l in enumerate(block) if l.strip()]
        pseudo = spec.get('pseudo') or html_outline(block, spec.get('notes', []))
        rows.node(spec['group'], spec['node'], f'index.html:{start + 1}', spec['purpose'], spec.get('links', ''), pseudo, code)
    return rows


# ------------------------------------------------------------------ CSS
def css_rules_outline(block):
    """Code thu nhỏ: selector → danh sách thuộc tính."""
    text = '\n'.join(block)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    out = []
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', text):
        sel = ' '.join(m.group(1).split())
        props = [p.split(':')[0].strip() for p in m.group(2).split(';') if ':' in p]
        if not sel or not props:
            continue
        out.append((short(f'{sel} → {", ".join(dict.fromkeys(props))}', 96), note_for(sel + m.group(2), CSS_LINE_NOTES)))
    return out


def build_css():
    lines = read('css/style.css')
    heads = [(i, re.search(r'/\* -+ (.+?) -+ \*/', l).group(1)) for i, l in enumerate(lines) if re.match(r'/\* -{5,} .+ -{5,} \*/', l)]
    sections = [(0, 'Design token & nền tảng')] + heads
    rows = Rows()
    seen = {}
    for idx, (start, title) in enumerate(sections):
        end = sections[idx + 1][0] if idx + 1 < len(sections) else len(lines)
        block = lines[start:end]
        n = seen.get(title, 0) + 1
        seen[title] = n
        name = title if n == 1 else f'{title} ({n})'
        code = [(start + 1 + k, l.rstrip(), note_for(l, CSS_LINE_NOTES)) for k, l in enumerate(block) if l.strip()]
        group = next((g for g, keys in CSS_GROUPS if any(k in title for k in keys)), 'Theo màn hình')
        rows.node(group, name, f'css/style.css:{start + 1}', CSS_PURPOSE.get(title, ''), '', css_rules_outline(block), code)
    return rows


# ------------------------------------------------------------------ JS
FUNC_RE = re.compile(r'^(\s*)(export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(')
CONST_RE = re.compile(r'^(export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(Object\.freeze\(|\{|\[|`|new |\(|createTid)')
SECTION_RE = re.compile(r'^// -{10,}\s*(.+)$')
SW_RE = re.compile(r"^self\.addEventListener\('([a-z]+)'")


def block_end(lines, start, indent):
    """Dòng kết thúc khối bắt đầu ở `start` (đếm ngoặc, bỏ qua chuỗi đơn giản)."""
    depth = 0
    opened = False
    for i in range(start, len(lines)):
        s = re.sub(r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"", '""', lines[i])
        s = re.sub(r'//.*$', '', s)
        for ch in s:
            if ch in '{[(':
                depth += 1
                opened = True
            elif ch in '}])':
                depth -= 1
        if opened and depth <= 0:
            return i
    return len(lines) - 1


def leading_comment(lines, i):
    out = []
    j = i - 1
    while j >= 0 and lines[j].strip().startswith('//') and not SECTION_RE.match(lines[j].strip()):
        out.insert(0, lines[j].strip().lstrip('/').strip())
        j -= 1
    return ' '.join(out)


def auto_pseudo(body):
    """Code thu nhỏ cho hàm chưa có pseudo viết tay: giữ dòng điều khiển và lời gọi chính."""
    out = []
    for raw in body[1:-1]:
        s = raw.strip()
        if not s or s in ('}', '});', '};', ');', '})', ']);') or s.startswith('//'):
            continue
        s = re.sub(r'^(const|let|var)\s+', '', s)
        s = re.sub(r'\s*=\s*', ' ← ', s, count=1) if re.match(r'^[A-Za-z0-9_${}\[\], .]+\s*=[^=>]', s) else s
        s = s.rstrip('{').rstrip()
        out.append((short(s, 80), note_for(raw, JS_LINE_NOTES)))
        if len(out) >= MAX_PSEUDO:
            break
    return out


def build_js(files):
    rows = Rows()
    for rel, base_group in files:
        lines = read(rel)
        group = base_group
        for i, line in enumerate(lines):
            sec = SECTION_RE.match(line.strip())
            if sec and rel == 'js/app.js':
                group = 'app.js · ' + re.sub(r'^\d+[a-z]?\.\s*', '', sec.group(1)).strip()
                continue
            m = FUNC_RE.match(line)
            c = CONST_RE.match(line) if not m else None
            w = SW_RE.match(line) if rel == 'sw.js' else None
            if not (m or c or w):
                continue
            if m and len(m.group(1)) > 2:
                continue  # hàm lồng sâu hơn 1 mức: thuộc về hàm cha
            name = m.group(4) if m else c.group(2) if c else f"sự kiện {w.group(1)}"
            if c and name in ('$', '$$'):
                pass
            end = block_end(lines, i, 0)
            body = lines[i:end + 1]
            info = JS_NOTES.get(f'{rel}:{name}') or JS_NOTES.get(name) or {}
            purpose = info.get('purpose') or leading_comment(lines, i) or SHORT_PURPOSE.get(name, '')
            nested = m is not None and len(m.group(1)) == 2
            sig = line.strip().rstrip('{').strip()
            code = [(i + 1 + k, l.rstrip(), note_for(l, info.get('notes', []) + JS_LINE_NOTES)) for k, l in enumerate(body) if l.strip()]
            pseudo = info.get('pseudo') or ([(sig, purpose)] + auto_pseudo(body) if not c else [(short(sig, 90), purpose)])
            node_name = f'{name}()' if m else name
            g = group if rel == 'js/app.js' else (base_group + (' · trong mount' if nested else ''))
            rows.node(g, node_name, f'{rel}:{i + 1}', purpose, info.get('links', ''), pseudo, code)
    return rows


ADAPTER = ("{kind: 'csv', hasHeader: true, columns: [" + ', '.join(["{type: {kind: 'literal', type: 'string'}}"] * 6) + "]}")


def widget(slug, title, blobs):
    """In code widget cho 1 tab. blobs: ['tên=blob/xxxx', ...] (tên = biến nguồn)."""
    with open(os.path.join(os.path.dirname(__file__), 'explorer_widget.jsx'), encoding='utf-8') as f:
        code = f.read()
    pairs = [b.split('=', 1) for b in blobs]
    sources = ', '.join(f"{n}: {{kind: 'ref', ref: '{ref}', adapter: {ADAPTER}}}" for n, ref in pairs)
    args = '{ ' + ', '.join(n for n, _ in pairs) + ' }'
    rows = '[' + ', '.join(f'...{n}' for n, _ in pairs) + ']'
    code = (code.replace('__SLUG__', slug).replace('__TITLE__', title).replace('__SOURCES__', sources)
            .replace('__ARGS__', args).replace('__ROWS__', rows))
    path = os.path.join(OUT, f'{slug}.jsx')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(code)
    print(path, len(code), 'ký tự')


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--widget':
        widget(sys.argv[2], sys.argv[3], sys.argv[4:])
        return
    results = [build_html().write('html.csv'), build_css().write('css.csv')]
    for name, files in JS_FILES.items():
        rows = build_js(files)
        if name == 'js-core':
            for spec in STATIC_NODES:
                lines = read(spec['file'])
                code = [(k + 1, l.rstrip(), '') for k, l in enumerate(lines) if l.strip()]
                rows.node('JSON & cấu hình', spec['node'], spec['file'], spec['purpose'], spec['links'], spec['pseudo'], code)
        parts = rows.split() if len(rows.rows) > 1900 else [rows]
        for k, part in enumerate(parts, 1):
            results.append(part.write(f'{name}.csv' if len(parts) == 1 else f'{name}-{k}.csv'))
    for path, n in results:
        flag = '  ⚠ quá 2000 dòng' if n > 2000 else ''
        print(f'{os.path.relpath(path, ROOT)}: {n} dòng{flag}')


if __name__ == '__main__':
    main()
