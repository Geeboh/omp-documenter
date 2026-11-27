#!/usr/bin/env bash
set -euo pipefail

VERSION='2.0.1'
PACKAGE='omp-documenter'
DEST="${HOME}/.local/share/omp-documenter-${VERSION}"

usage() {
  cat <<'EOF'
Usage: omp-documenter-uninstall.sh [--dir PATH]

Unlinks OMP Documenter from the user OMP profile and removes only an owned
Documenter 2.0.1 installation directory. Project `.documenter` state remains.
EOF
}

while (($#)); do
  case "$1" in
    --dir)
      (($# >= 2)) || { echo '--dir requires a path' >&2; exit 2; }
      DEST=$2
      shift 2
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

command -v node >/dev/null || { echo 'Node.js is required' >&2; exit 1; }
command -v omp >/dev/null || { echo 'OMP is required' >&2; exit 1; }

if [[ ! -e "$DEST" ]]; then
  printf 'Not installed: %s\n' "$DEST"
  exit 0
fi
if [[ ! -f "$DEST/package.json" ]]; then
  echo "Refusing an unmanaged destination: $DEST" >&2
  exit 1
fi
node -e 'const p=require(process.argv[1]); if(p.name!=="omp-documenter" || p.version!==process.argv[2]) process.exit(1)' "$DEST/package.json" "$VERSION" || {
  echo "Refusing an unmanaged destination: $DEST" >&2
  exit 1
}

omp plugin uninstall "$PACKAGE" --scope=user >/dev/null 2>&1 || true
rm -rf -- "$DEST"
printf 'Uninstalled OMP Documenter %s from %s\n' "$VERSION" "$DEST"
printf 'Project .documenter state was not changed.\n'
