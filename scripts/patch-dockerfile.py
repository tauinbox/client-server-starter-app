#!/usr/bin/env python3
"""
patch-dockerfile.py <dockerfile> <pkg1> [<pkg2> ...]

Adds or updates an EDGE_PATCHES_START/END block in a Dockerfile's
runtime stage (identified by `FROM ... AS runner`) to install the
given packages from the Alpine edge/main channel.
"""
import sys
import re


def find_insert_after(lines: list) -> object:
    """Return the line index to insert after the first RUN apk upgrade in the runner stage."""
    in_runner = False
    in_run = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        if re.match(r'FROM\s+\S+\s+AS\s+runner\b', stripped, re.IGNORECASE):
            in_runner = True
            continue
        if not in_runner:
            continue
        if re.match(r'FROM\s+', stripped):  # next stage starts
            break
        if not in_run and re.match(r'RUN\s+apk\s+upgrade', stripped):
            in_run = True
        if in_run and not stripped.endswith('\\'):
            return i + 1
    return None


def main():
    if len(sys.argv) < 3:
        print(f'Usage: {sys.argv[0]} <dockerfile> <pkg1> [<pkg2> ...]', file=sys.stderr)
        sys.exit(1)

    dockerfile_path = sys.argv[1]
    packages = sys.argv[2:]
    pkg_list = ' '.join(packages)

    with open(dockerfile_path) as f:
        content = f.read()

    block = (
        '# EDGE_PATCHES_START\n'
        'RUN apk upgrade --no-cache \\\n'
        '    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main \\\n'
        f'    {pkg_list}\n'
        '# EDGE_PATCHES_END\n'
    )

    if 'EDGE_PATCHES_START' in content:
        content = re.sub(
            r'# EDGE_PATCHES_START\n.*?# EDGE_PATCHES_END\n',
            block,
            content,
            flags=re.DOTALL,
        )
        print(f'Updated EDGE_PATCHES block in {dockerfile_path}: {pkg_list}')
    else:
        lines = content.splitlines(keepends=True)
        idx = find_insert_after(lines)
        if idx is None:
            print(
                f'ERROR: could not find insertion point in {dockerfile_path}',
                file=sys.stderr,
            )
            sys.exit(1)
        lines.insert(idx, block)
        content = ''.join(lines)
        print(f'Added EDGE_PATCHES block to {dockerfile_path}: {pkg_list}')

    with open(dockerfile_path, 'w') as f:
        f.write(content)


if __name__ == '__main__':
    main()
