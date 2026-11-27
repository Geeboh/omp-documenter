#!/usr/bin/env bash
set -euo pipefail

VERSION='2.0.1'
PACKAGE='omp-documenter'
BASE_URL="${DOCUMENTER_RELEASE_BASE_URL:-https://github.com/Geeboh/omp-documenter/releases/download/v${VERSION}}"
DEFAULT_DIR="${HOME}/.local/share/omp-documenter-${VERSION}"
DEST="$DEFAULT_DIR"
FRESH=0

usage() {
  cat <<'EOF'
Usage: omp-documenter-install.sh [--dir PATH] [--fresh]

Installs a fresh copy or upgrades an existing owned OMP Documenter 2.0.0
directory. It approves only the four pinned Tree-sitter native install
scripts before npm install, then rebuilds them and links the package to OMP.
EOF
}

while (($#)); do
  case "$1" in
    --dir)
      (($# >= 2)) || { echo '--dir requires a path' >&2; exit 2; }
      DEST=$2
      shift 2
      ;;
    --fresh)
      FRESH=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v curl >/dev/null || { echo 'curl is required' >&2; exit 1; }
command -v node >/dev/null || { echo 'Node.js 22 or later is required' >&2; exit 1; }
command -v npm >/dev/null || { echo 'npm is required' >&2; exit 1; }
command -v omp >/dev/null || { echo 'OMP is required' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || { echo 'Node.js 22 or later is required' >&2; exit 1; }

owned_destination() {
  [[ -f "$1/package.json" ]] || return 1
  node -e 'const p=require(process.argv[1]); if(p.name!=="omp-documenter" || p.version!==process.argv[2]) process.exit(1)' "$1/package.json" "$VERSION"
}

if [[ -e "$DEST" ]] && ! owned_destination "$DEST"; then
  echo "Refusing an unmanaged destination: $DEST" >&2
  exit 1
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/omp-documenter-install.XXXXXX")
staging="$DEST"
backup=''
upgrade=0
cleanup() {
  rm -rf -- "$work"
  if [[ -n "$staging" && "$staging" != "$DEST" && -e "$staging" ]]; then rm -rf -- "$staging"; fi
}
trap cleanup EXIT

if [[ -e "$DEST" && "$FRESH" == 0 ]]; then
  upgrade=1
  staging="${DEST}.staging.$$"
elif [[ -e "$DEST" ]]; then
  omp plugin uninstall "$PACKAGE" --scope=user >/dev/null 2>&1 || true
  rm -rf -- "$DEST"
fi

mkdir -p "$(dirname "$DEST")"
installer="$work/omp-documenter-${VERSION}-install.mjs"
checksum="$work/omp-documenter-${VERSION}-install.mjs.sha256"
curl -fsSL "$BASE_URL/omp-documenter-${VERSION}-install.mjs" -o "$installer"
curl -fsSL "$BASE_URL/omp-documenter-${VERSION}-install.mjs.sha256" -o "$checksum"
expected=$(awk 'NR == 1 { print $1 }' "$checksum")
actual=$(sha256sum "$installer" | awk '{ print $1 }')
[[ -n "$expected" && "$actual" == "$expected" ]] || { echo 'Installer checksum mismatch.' >&2; exit 1; }

node "$installer" "$staging"
cd "$staging"
npm install --omit=dev --ignore-scripts
npm install-scripts approve \
  tree-sitter@0.21.1 \
  tree-sitter-javascript@0.23.1 \
  tree-sitter-python@0.23.3 \
  tree-sitter-typescript@0.23.2 \
  --allow-scripts-pin
npm rebuild tree-sitter tree-sitter-javascript tree-sitter-python tree-sitter-typescript

if [[ "$upgrade" == 1 ]]; then
  cd /
  backup="${DEST}.backup.$$"
  mv "$DEST" "$backup"
  mv "$staging" "$DEST"
  staging="$DEST"
  if ! omp plugin link "$DEST"; then
    rm -rf -- "$DEST"
    mv "$backup" "$DEST"
    omp plugin link "$DEST" >/dev/null 2>&1 || true
    exit 1
  fi
  rm -rf -- "$backup"
else
  omp plugin link "$DEST"
fi

printf 'Installed OMP Documenter %s at %s\n' "$VERSION" "$DEST"
printf 'Run a new OMP session, then use /documenter status.\n'
