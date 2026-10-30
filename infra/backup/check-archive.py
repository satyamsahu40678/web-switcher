#!/usr/bin/env python3
"""Pass a nonempty pg_dump custom archive onward; reject an empty producer."""
import shutil
import sys

header = sys.stdin.buffer.read(32)
if len(header) < 32 or not header.startswith(b"PGDMP"):
    raise SystemExit("pg_dump did not produce a custom-format archive")
sys.stdout.buffer.write(header)
shutil.copyfileobj(sys.stdin.buffer, sys.stdout.buffer)
