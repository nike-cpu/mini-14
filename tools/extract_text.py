# -*- coding: utf-8 -*-
"""Extract plain text from an uploaded file (txt/md/csv/json/html/docx/pdf)."""
import json
import os
import re
import sys
import zipfile


def from_text(path):
    raw = open(path, 'rb').read()
    for enc in ('utf-8', 'utf-8-sig', 'gbk', 'gb18030', 'big5'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', 'ignore')


def from_html(s):
    s = re.sub(r'<(script|style)[^>]*>[\s\S]*?</\1>', ' ', s, flags=re.I)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = s.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    return s


def from_docx(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read('word/document.xml').decode('utf-8', 'ignore')
    xml = xml.replace('</w:p>', '\n').replace('<w:tab/>', '\t').replace('<w:br/>', '\n')
    return re.sub(r'<[^>]+>', '', xml)


def from_pdf(path):
    from pypdf import PdfReader
    reader = PdfReader(path)
    out = []
    for page in reader.pages[:200]:
        try:
            out.append(page.extract_text() or '')
        except Exception:
            out.append('')
    return '\n'.join(out)


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    try:
        path = sys.argv[1]
        ext = os.path.splitext(path)[1].lower()
        if ext == '.docx':
            text = from_docx(path)
        elif ext == '.pdf':
            text = from_pdf(path)
        elif ext in ('.html', '.htm'):
            text = from_html(from_text(path))
        elif ext in ('.xlsx', '.xls'):
            text = '（暂时不支持 Excel，请另存为 CSV 再上传）'
        else:
            text = from_text(path)
        text = re.sub(r'[ \t]+\n', '\n', text)
        text = re.sub(r'\n{3,}', '\n\n', text).strip()
        json.dump({'ok': True, 'text': text, 'chars': len(text)}, sys.stdout, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        json.dump({'ok': False, 'error': str(e)}, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
