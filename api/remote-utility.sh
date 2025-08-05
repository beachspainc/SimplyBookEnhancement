#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# remote-utility.sh
# Helper script executed *on the remote GCP VM* by deploy.ps1.
#
# Responsibilities:
#   • Build / unpack tarballs filtered by include / exclude lists
#   • Offer simple clean‑up helpers
#   • Always emit explicit, timestamped logs for traceability
#
# Usage:
#   ./remote-utility.sh pack   <SRC_DIR> <INCLUDE_FILE> <EXCLUDE_FILE> <OUTPUT_TAR>
#   ./remote-utility.sh unpack <TAR_FILE> <DEST_DIR>
#   ./remote-utility.sh clean  <FILE_OR_DIR> [...]
#
# Notes:
#   • INCLUDE_FILE / EXCLUDE_FILE are plain‑text lists (one pattern per line)
#     following standard rsync wild‑card syntax.
#   • All paths should be absolute on the remote machine.
#   • Designed for non‑interactive execution via SSH (no prompts).
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_NAME=$(basename "$0")

# -------- Logging helpers ---------------------------------------------------
log() {
  local lvl="$1"; shift
  printf '[%s] %-5s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$lvl" "$*" >&2
}
die() { log "ERROR" "$*"; exit 1; }
warn() { log "WARN"  "$*"; }
info() { log "INFO"  "$*"; }

usage() {
  cat <<EOF
$SCRIPT_NAME – remote file packer / unpacker

USAGE
  $SCRIPT_NAME pack   <SRC_DIR> <INCLUDE_FILE> <EXCLUDE_FILE> <OUTPUT_TAR>
  $SCRIPT_NAME unpack <TAR_FILE> <DEST_DIR>
  $SCRIPT_NAME clean  <FILE_OR_DIR> [...]

EXAMPLES
  # Build a tarball from /var/www using include/exclude rules
  $SCRIPT_NAME pack /var/www /tmp/include.lst /tmp/exclude.lst /tmp/site.tgz

  # Unpack to /tmp/workspace
  $SCRIPT_NAME unpack /tmp/site.tgz /tmp/workspace

  # Remove a temporary directory
  $SCRIPT_NAME clean /tmp/workspace
EOF
}

[[ $# -lt 1 ]] && { usage; exit 1; }

CMD="$1"; shift

case "$CMD" in
  pack)
    [[ $# -eq 4 ]] || die "pack requires 4 args (SRC_DIR INCLUDE_FILE EXCLUDE_FILE OUTPUT_TAR)"
    SRC_DIR="$1"; INCLUDE_FILE="$2"; EXCLUDE_FILE="$3"; OUTPUT_TAR="$4"

    [[ -d "$SRC_DIR" ]]      || die "SRC_DIR '$SRC_DIR' is not a directory"
    [[ -f "$INCLUDE_FILE" ]] || die "INCLUDE_FILE '$INCLUDE_FILE' does not exist"
    [[ -f "$EXCLUDE_FILE" ]] || die "EXCLUDE_FILE '$EXCLUDE_FILE' does not exist"

    info "Packing from \$SRC_DIR with rules -> \$OUTPUT_TAR"

    # Assemble rsync include / exclude flags
    mapfile -t RSYNC_INCLUDE < <( sed '/^\s*$/d' "$INCLUDE_FILE" | sed 's/^/--include=/' )
    mapfile -t RSYNC_EXCLUDE < <( sed '/^\s*$/d' "$EXCLUDE_FILE" | sed 's/^/--exclude=/' )

    TMPDIR="$(mktemp -d)"
    trap 'rm -rf "$TMPDIR"' EXIT

    info "Generating file list via rsync (dry‑run)…"
    rsync -aR --dry-run "${RSYNC_INCLUDE[@]}" "${RSYNC_EXCLUDE[@]}" "$SRC_DIR/" "$TMPDIR/list/" \
      | awk '/^\.d/ {next} {print $2}' > "$TMPDIR/filelist"

    COUNT="$(wc -l < "$TMPDIR/filelist")"
    info "Files selected: \$COUNT"

    tar -czf "$OUTPUT_TAR" -C "$SRC_DIR" -T "$TMPDIR/filelist"
    SIZE="$(du -h "$OUTPUT_TAR" | cut -f1)"
    info "Tarball created (\$SIZE)"
    ;;

  unpack)
    [[ $# -eq 2 ]] || die "unpack requires 2 args (TAR_FILE DEST_DIR)"
    TAR_FILE="$1"; DEST_DIR="$2"

    [[ -f "$TAR_FILE" ]] || die "TAR_FILE '$TAR_FILE' does not exist"

    mkdir -p "$DEST_DIR"
    info "Unpacking \$TAR_FILE -> \$DEST_DIR"
    tar -xzf "$TAR_FILE" -C "$DEST_DIR"
    info "Unpack completed"
    ;;

  clean)
    [[ $# -ge 1 ]] || die "clean requires at least 1 arg (FILE_OR_DIR)"    
    for target in "$@"; do
      if [[ -e "$target" ]]; then
        info "Removing \$target"
        rm -rf "$target"
      else
        warn "\$target does not exist – skipping"
      fi
    done
    ;;

  *)
    usage; exit 1 ;;
esac
