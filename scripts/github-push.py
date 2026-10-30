#!/usr/bin/env python3
"""Push this branch using a securely injected token, never stored in Git config."""
import base64
import os
import subprocess
import sys

token = os.environ.get('GITHUB_AUTH_TOKEN')
if not token:
    sys.exit('Configure GITHUB_AUTH_TOKEN securely in the environment before pushing.')
result = subprocess.run(['git', 'remote', 'get-url', 'origin'], capture_output=True, text=True, check=True)
if result.stdout.strip() != 'https://github.com/satyamsahu40678/web-switcher.git':
    sys.exit('Unexpected origin; inspect repository configuration before authenticating.')
config = os.environ.copy()
# Pass authentication to Git in its process environment, never command arguments,
# persistent config, source, log output or a token-bearing remote URL.
count = int(config.get('GIT_CONFIG_COUNT', '0'))
config['GIT_CONFIG_COUNT'] = str(count + 1)
config[f'GIT_CONFIG_KEY_{count}'] = 'http.https://github.com/.extraHeader'
config[f'GIT_CONFIG_VALUE_{count}'] = 'Authorization: Basic ' + base64.b64encode(('x-access-token:' + token).encode()).decode()
config['GIT_TERMINAL_PROMPT'] = '0'
args = ['--dry-run'] if '--dry-run' in sys.argv[1:] else []
raise SystemExit(subprocess.call(['git', 'push', *args, 'origin', 'HEAD:refs/heads/feat/web-switcher-platform'], env=config))
