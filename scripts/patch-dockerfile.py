#!/usr/bin/env python3
"""
patch-dockerfile.py [--channel {stable,edge}] <dockerfile> <pkg1> [<pkg2> ...]

Adds or updates a CVE_PATCHES_START/END block in a Dockerfile's runtime stage
(identified by `FROM ... AS runner`) to upgrade the given packages.

The block uses `apk add --no-cache --upgrade`, which rewrites any exact-version
pin in /etc/apk/world so a pinned package can actually move (plain `apk upgrade`
honours the pin and no-ops).

When a block already exists, the given packages are MERGED with the ones already
listed (union, de-duplicated) rather than replacing them — a later, unrelated CVE
must not silently drop a still-needed earlier patch. Accumulation is bounded by the
quarterly edge-patch-cleanup workflow, which removes the whole block and rebuilds to
check whether the fixes have reached the base image.

Channels:
  stable (default) — upgrade from the repositories already configured in the
                     image (security fixes are normally backported to stable).
  edge             — also expose the Alpine edge/main and edge/community
                     repositories, for the rare fix not yet in stable.
"""
import argparse
import re

# Tokens that appear inside a block but are not package names.
_NON_PKG_TOKENS = {'RUN', 'apk', 'add', 'upgrade', '--no-cache', '--upgrade', '\\'}

START = '# CVE_PATCHES_START'
END = '# CVE_PATCHES_END'
# Match the current marker and the legacy EDGE_PATCHES name so an old block is
# transparently replaced with the new format.
BLOCK_RE = re.compile(
    r'# (?:CVE|EDGE)_PATCHES_START\n.*?# (?:CVE|EDGE)_PATCHES_END\n',
    re.DOTALL,
)

EDGE_REPOS = (
    '    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main \\\n'
    '    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community \\\n'
)


def build_block(packages: list, channel: str) -> str:
    pkg_list = ' '.join(packages)
    repos = EDGE_REPOS if channel == 'edge' else ''
    return (
        f'{START}\n'
        'RUN apk add --no-cache --upgrade \\\n'
        f'{repos}'
        f'    {pkg_list}\n'
        f'{END}\n'
    )


def existing_packages(block_text: str) -> list:
    """Extract package names from an existing block (handles old and new formats)."""
    pkgs = []
    for line in block_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        for tok in stripped.split():
            if tok in _NON_PKG_TOKENS or tok.startswith('--repository'):
                continue
            pkgs.append(tok)
    return pkgs


def find_insert_after(lines: list):
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
        if not in_run and re.match(r'RUN\s+apk\s+(?:upgrade|add)', stripped):
            in_run = True
        if in_run and not stripped.endswith('\\'):
            return i + 1
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--channel', choices=('stable', 'edge'), default='stable')
    parser.add_argument('dockerfile')
    parser.add_argument('packages', nargs='+')
    args = parser.parse_args()

    with open(args.dockerfile) as f:
        content = f.read()

    match = BLOCK_RE.search(content)
    if match:
        packages = sorted(set(existing_packages(match.group(0))) | set(args.packages))
        block = build_block(packages, args.channel)
        # Function replacement avoids re interpreting backslashes in the block.
        content = BLOCK_RE.sub(lambda _m: block, content, count=1)
        action = 'Updated'
    else:
        packages = sorted(set(args.packages))
        block = build_block(packages, args.channel)
        lines = content.splitlines(keepends=True)
        idx = find_insert_after(lines)
        if idx is None:
            parser.error(f'could not find insertion point in {args.dockerfile}')
        lines.insert(idx, block)
        content = ''.join(lines)
        action = 'Added'

    with open(args.dockerfile, 'w') as f:
        f.write(content)

    print(f'{action} CVE_PATCHES block in {args.dockerfile} [{args.channel}]: {" ".join(packages)}')


if __name__ == '__main__':
    main()
