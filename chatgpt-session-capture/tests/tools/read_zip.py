"""Reads a ZIP produced by the extension and prints a JSON description.

Usage: python3 -I read_zip.py <archive.zip>

Validates every entry's CRC-32 with zipfile.testzip() and returns the
decoded text of each entry, so the Node test can assert on content.
"""
import json
import sys
import zipfile


def main(path):
    with zipfile.ZipFile(path) as archive:
        bad = archive.testzip()
        entries = {}
        for info in archive.infolist():
            data = archive.read(info.filename)
            try:
                text = data.decode('utf-8')
            except UnicodeDecodeError:
                text = None
            entries[info.filename] = {
                'size': info.file_size,
                'compressed': info.compress_size,
                'method': info.compress_type,
                'utf8Flag': bool(info.flag_bits & 0x800),
                'text': text,
            }
    print(json.dumps({'firstBadEntry': bad, 'entries': entries}))


if __name__ == '__main__':
    main(sys.argv[1])
