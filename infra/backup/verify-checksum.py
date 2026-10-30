#!/usr/bin/env python3
"""Verify one adjacent checksum without trusting filenames supplied by its text."""
import hashlib
import re
import sys
from pathlib import Path

try:
    archive = Path(sys.argv[1])
    if not archive.is_file() or any(char in archive.name for char in ('\n', '\r', '\x00')):
        raise ValueError('Select a regular archive with a single-line basename.')
    checksum = Path(str(archive) + '.sha256')
    if not checksum.is_file() or checksum.stat().st_size > 2048:
        raise ValueError('A bounded adjacent .sha256 checksum file is required.')
    text = checksum.read_text(encoding='utf-8')
    match = re.fullmatch(r'([0-9a-fA-F]{64}) [ *]([^\r\n]+)\n?', text)
    if not match or match.group(2) != archive.name:
        raise ValueError('Checksum must name exactly this archive basename.')
    with archive.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual != match.group(1).lower():
        raise ValueError('Encrypted archive checksum mismatch; restore refused.')
except (OSError, UnicodeError, ValueError, IndexError) as error:
    raise SystemExit(str(error))
