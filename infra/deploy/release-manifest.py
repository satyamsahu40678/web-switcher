#!/usr/bin/env python3
"""Validate public release metadata without evaluating a shell/env file."""
import json,re,sys
from pathlib import Path

def validate(data):
    if not isinstance(data,dict) or set(data)!= {'schemaVersion','sourceCommit','apiImage','webImage'} or type(data['schemaVersion']) is not int or data['schemaVersion']!=1:
        raise ValueError('Unsupported or unexpected release manifest fields')
    if not isinstance(data['sourceCommit'],str) or not re.fullmatch(r'[0-9a-f]{40}',data['sourceCommit']):raise ValueError('A full source commit is required')
    for service in ('api','web'):
        expected=r'ghcr\.io/satyamsahu40678/web-switcher-'+service+r'@sha256:[0-9a-f]{64}'
        if not isinstance(data[service+'Image'],str) or not re.fullmatch(expected,data[service+'Image']):raise ValueError('Use digest-pinned images from this repository namespace')
    return data
if __name__=='__main__':
    try:
        path=Path(sys.argv[1])
        if path.stat().st_size>16384:raise ValueError('Release manifest exceeds16KiB')
        def unique(pairs):
            value={}
            for key,item in pairs:
                if key in value:raise ValueError('Duplicate manifest field')
                value[key]=item
            return value
        data=validate(json.loads(path.read_text(),object_pairs_hook=unique))
        if '--env' in sys.argv:
            print('SOURCE_COMMIT='+data['sourceCommit']);print('API_IMAGE='+data['apiImage']);print('WEB_IMAGE='+data['webImage'])
        else:print('Release manifest is valid and immutable.')
    except (ValueError,KeyError,OSError,IndexError) as error:sys.exit(str(error))
