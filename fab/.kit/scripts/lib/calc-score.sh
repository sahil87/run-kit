#!/usr/bin/env bash
set -euo pipefail
# calc-score.sh — Compute confidence score from Assumptions table
#
# Internal library script invoked by /fab-continue (spec stage) and
# /fab-clarify (suggest mode). Not called directly by users.
#
# Usage: calc-score.sh [--stage <stage>] <change>
#        calc-score.sh --check-gate [--stage <stage>] <change>
# Output: YAML confidence block to stdout (or gate result for --check-gate)
# Side effect: Updates confidence block in .status.yaml (normal mode only)
# Exit: 0 on success, 1 on error (message to stderr)

LIB_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
STATUSMAN="$LIB_DIR/statusman.sh"
LOGMAN="$LIB_DIR/logman.sh"
RESOLVE="$LIB_DIR/resolve.sh"

# ─────────────────────────────────────────────────────────────────────────────
# Tunable Configuration
# ─────────────────────────────────────────────────────────────────────────────

# Penalty weights per decision grade (subtracted from ceiling of 5.0).
# Formula: base = max(0, 5.0 - W_CERTAIN*certain - W_CONFIDENT*confident
#                                - W_TENTATIVE*tentative)
# Note: when unresolved > 0, score is forced to 0.0 regardless of weights.
W_CERTAIN=0.0
W_CONFIDENT=0.3
W_TENTATIVE=1.0
W_UNRESOLVED=5.0

# Expected minimum decisions by {stage, type}.
# Controls the coverage factor: cover = min(1.0, total_decisions / expected_min)
EXPECTED_MIN_INTAKE_FEAT=5
EXPECTED_MIN_INTAKE_REFACTOR=4
EXPECTED_MIN_INTAKE_FIX=3
EXPECTED_MIN_INTAKE_DEFAULT=2

EXPECTED_MIN_SPEC_FEAT=7
EXPECTED_MIN_SPEC_REFACTOR=6
EXPECTED_MIN_SPEC_FIX=5
EXPECTED_MIN_SPEC_DEFAULT=3

# --- Expected minimum decisions by stage and change_type ---
get_expected_min() {
  local stage="$1" change_type="$2"
  case "$stage" in
    intake)
      case "$change_type" in
        fix) echo "$EXPECTED_MIN_INTAKE_FIX" ;; feat) echo "$EXPECTED_MIN_INTAKE_FEAT" ;;
        refactor) echo "$EXPECTED_MIN_INTAKE_REFACTOR" ;; *) echo "$EXPECTED_MIN_INTAKE_DEFAULT" ;;
      esac ;;
    spec|*)
      case "$change_type" in
        fix) echo "$EXPECTED_MIN_SPEC_FIX" ;; feat) echo "$EXPECTED_MIN_SPEC_FEAT" ;;
        refactor) echo "$EXPECTED_MIN_SPEC_REFACTOR" ;; *) echo "$EXPECTED_MIN_SPEC_DEFAULT" ;;
      esac ;;
  esac
}

# --- Gate thresholds by change type (7-type taxonomy) ---
get_gate_threshold() {
  local change_type="$1"
  case "$change_type" in
    fix)      echo "2.0" ;;
    feat)     echo "3.0" ;;
    refactor) echo "3.0" ;;
    docs)     echo "2.0" ;;
    test)     echo "2.0" ;;
    ci)       echo "2.0" ;;
    chore)    echo "2.0" ;;
    *)        echo "3.0" ;;  # default to feat threshold
  esac
}

# --- Read change_type from .status.yaml (default: feat) ---
read_change_type() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "feat"
    return
  fi
  local ct
  ct=$(grep '^ *change_type:' "$file" | sed 's/^ *change_type: *//' || echo "")
  ct=$(echo "$ct" | tr -d '[:space:]')
  if [ -z "$ct" ] || [ "$ct" = "null" ]; then
    echo "feat"
  else
    echo "$ct"
  fi
}

# --- Parse Assumptions table ---
# Extract Grade and Scores column values from ## Assumptions table.
# Scores column is required (column 6 after split by |).
# Outputs lines in format: "grade|S:nn R:nn A:nn D:nn"
parse_assumptions() {
  local file="$1"
  if [ ! -f "$file" ]; then
    return
  fi
  awk '
    /^## Assumptions/ { in_section = 1; header_seen = 0; next }
    in_section && /^## / { exit }
    in_section && /^\| *#/ {
      header_seen = 1
      next
    }
    in_section && /^\|[-| ]+\|/ { next }
    in_section && header_seen && /^\|/ {
      split($0, cols, "|")
      grade = cols[3]
      gsub(/^[ \t]+|[ \t]+$/, "", grade)

      scores = cols[6]
      gsub(/^[ \t]+|[ \t]+$/, "", scores)
      print grade "|" scores
    }
  ' "$file"
}

# ─────────────────────────────────────────────────────────────────────────────
# DRY Helpers
# ─────────────────────────────────────────────────────────────────────────────

# count_grades <file> — Parse Assumptions table from markdown file.
# Outputs: certain confident tentative unresolved has_fuzzy dim_count sum_s sum_r sum_a sum_d
# (space-separated, single line)
count_grades() {
  local file="$1"
  local g_certain=0 g_confident=0 g_tentative=0 g_unresolved=0
  local has_fuzzy=false dim_count=0 sum_s=0 sum_r=0 sum_a=0 sum_d=0

  while IFS= read -r line; do
    [ -z "$line" ] && continue

    grade="${line%%|*}"
    scores_part=""
    if [[ "$line" == *"|"* ]]; then
      scores_part="${line#*|}"
    fi

    grade_lower=$(echo "$grade" | tr '[:upper:]' '[:lower:]')
    case "$grade_lower" in
      certain)    g_certain=$((g_certain + 1)) ;;
      confident)  g_confident=$((g_confident + 1)) ;;
      tentative)  g_tentative=$((g_tentative + 1)) ;;
      unresolved) g_unresolved=$((g_unresolved + 1)) ;;
    esac

    if [ -n "$scores_part" ]; then
      s_val=$(echo "$scores_part" | sed -n 's/.*S:\([0-9][0-9]*\).*/\1/p')
      r_val=$(echo "$scores_part" | sed -n 's/.*R:\([0-9][0-9]*\).*/\1/p')
      a_val=$(echo "$scores_part" | sed -n 's/.*A:\([0-9][0-9]*\).*/\1/p')
      d_val=$(echo "$scores_part" | sed -n 's/.*D:\([0-9][0-9]*\).*/\1/p')

      if [ -n "$s_val" ] && [ -n "$r_val" ] && [ -n "$a_val" ] && [ -n "$d_val" ]; then
        has_fuzzy=true
        dim_count=$((dim_count + 1))
        sum_s=$((sum_s + s_val))
        sum_r=$((sum_r + r_val))
        sum_a=$((sum_a + a_val))
        sum_d=$((sum_d + d_val))
      fi
    fi
  done <<< "$(parse_assumptions "$file")"

  echo "$g_certain $g_confident $g_tentative $g_unresolved $has_fuzzy $dim_count $sum_s $sum_r $sum_a $sum_d"
}

# compute_score <certain> <confident> <tentative> <unresolved> <total> <expected_min>
# Compute confidence score. Outputs score on stdout.
compute_score() {
  local certain="$1" confident="$2" tentative="$3" unresolved="$4" total="$5" expected_min="$6"

  if [ "$unresolved" -gt 0 ]; then
    echo "0.0"
  else
    awk -v certain="$certain" -v confident="$confident" -v tentative="$tentative" \
        -v total="$total" -v exp_min="$expected_min" \
        -v wCe="$W_CERTAIN" -v wCo="$W_CONFIDENT" -v wT="$W_TENTATIVE" \
      "BEGIN {
        base = 5.0 - wCe * certain - wCo * confident - wT * tentative
        if (base < 0.0) base = 0.0
        if (exp_min > 0) cover = total / exp_min; else cover = 1.0
        if (cover > 1.0) cover = 1.0
        printf \"%.1f\", base * cover
      }"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Argument parsing
# ─────────────────────────────────────────────────────────────────────────────

CHECK_GATE=false
SCORE_STAGE="spec"

while [ $# -gt 0 ]; do
  case "${1:-}" in
    --check-gate)
      CHECK_GATE=true
      shift
      ;;
    --stage)
      SCORE_STAGE="${2:-spec}"
      shift 2
      ;;
    *)
      break
      ;;
  esac
done

change_arg="${1:-}"

if [ -z "$change_arg" ]; then
  echo "Usage: calc-score.sh [--check-gate] [--stage <stage>] <change>" >&2
  exit 1
fi

# Resolve change to directory via resolve.sh
change_dir=$("$RESOLVE" --dir "$change_arg") || exit 1
# Trim trailing slash
change_dir="${change_dir%/}"

if [ ! -d "$change_dir" ]; then
  echo "Change directory not found: $change_dir" >&2
  exit 1
fi

status_file="$change_dir/.status.yaml"

# ─────────────────────────────────────────────────────────────────────────────
# Gate check mode
# ─────────────────────────────────────────────────────────────────────────────

if [ "$CHECK_GATE" = true ]; then
  if [ ! -f "$status_file" ]; then
    echo "ERROR: .status.yaml not found in $change_dir" >&2
    exit 1
  fi

  change_type=$(read_change_type "$status_file")

  if [ "$SCORE_STAGE" = "intake" ]; then
    score_file="$change_dir/intake.md"
    threshold="3.0"
  else
    score_file="$change_dir/spec.md"
    threshold=$(get_gate_threshold "$change_type")
  fi

  if [ ! -f "$score_file" ]; then
    echo "ERROR: $(basename "$score_file") not found in $change_dir" >&2
    exit 1
  fi

  expected_min=$(get_expected_min "$SCORE_STAGE" "$change_type")

  # Count grades via shared helper
  read -r g_certain g_confident g_tentative g_unresolved _ _ _ _ _ _ <<< "$(count_grades "$score_file")"
  g_total=$((g_certain + g_confident + g_tentative + g_unresolved))
  score=$(compute_score "$g_certain" "$g_confident" "$g_tentative" "$g_unresolved" "$g_total" "$expected_min")

  # Compare score >= threshold
  passes=$(awk "BEGIN { print ($score >= $threshold) ? \"pass\" : \"fail\" }")

  cat <<EOF
gate: $passes
score: $score
threshold: $threshold
change_type: $change_type
certain: $g_certain
confident: $g_confident
tentative: $g_tentative
unresolved: $g_unresolved
EOF
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Normal scoring mode
# ─────────────────────────────────────────────────────────────────────────────

if [ "$SCORE_STAGE" = "intake" ]; then
  score_file="$change_dir/intake.md"
  if [ ! -f "$score_file" ]; then
    echo "intake.md required for scoring at intake stage" >&2
    exit 1
  fi
else
  score_file="$change_dir/spec.md"
  if [ ! -f "$score_file" ]; then
    echo "spec.md required for scoring" >&2
    exit 1
  fi
fi

change_type=$(read_change_type "$status_file")
expected_min=$(get_expected_min "$SCORE_STAGE" "$change_type")

# Count grades and dimension scores via shared helper
read -r table_certain table_confident table_tentative table_unresolved \
       has_fuzzy dim_count sum_s sum_r sum_a sum_d <<< "$(count_grades "$score_file")"

total_decisions=$((table_certain + table_confident + table_tentative + table_unresolved))

# Compute mean dimension scores
mean_s="0.0" mean_r="0.0" mean_a="0.0" mean_d="0.0"
if [ "$dim_count" -gt 0 ]; then
  mean_s=$(awk "BEGIN { printf \"%.1f\", $sum_s / $dim_count }")
  mean_r=$(awk "BEGIN { printf \"%.1f\", $sum_r / $dim_count }")
  mean_a=$(awk "BEGIN { printf \"%.1f\", $sum_a / $dim_count }")
  mean_d=$(awk "BEGIN { printf \"%.1f\", $sum_d / $dim_count }")
fi

# Read previous score for delta computation
prev_score="0.0"
if [ -f "$status_file" ]; then
  confidence_data=$("$STATUSMAN" confidence "$status_file")
  prev_score=$(echo "$confidence_data" | grep '^score:' | cut -d: -f2)
  prev_score=${prev_score:-0.0}
fi

# Compute score via shared helper
score=$(compute_score "$table_certain" "$table_confident" "$table_tentative" "$table_unresolved" "$total_decisions" "$expected_min")

# Compute delta
delta=$(awk "BEGIN {
  d = $score - $prev_score
  if (d >= 0) printf \"+%.1f\", d
  else printf \"%.1f\", d
}")

# Determine --indicative flag: set for intake scoring, omit for spec scoring
indicative_flag=""
if [ "$SCORE_STAGE" = "intake" ]; then
  indicative_flag="--indicative"
fi

# Write to .status.yaml and log
if [ -f "$status_file" ]; then
  if [ "$has_fuzzy" = true ]; then
    "$STATUSMAN" set-confidence-fuzzy "$status_file" "$table_certain" "$table_confident" "$table_tentative" "$table_unresolved" "$score" "$mean_s" "$mean_r" "$mean_a" "$mean_d" $indicative_flag
  else
    "$STATUSMAN" set-confidence "$status_file" "$table_certain" "$table_confident" "$table_tentative" "$table_unresolved" "$score" $indicative_flag
  fi
  change_folder=$(basename "$change_dir")
  "$LOGMAN" confidence "$change_folder" "$score" "$delta" "calc-score"
fi

# Emit YAML to stdout
cat <<EOF
confidence:
  certain: $table_certain
  confident: $table_confident
  tentative: $table_tentative
  unresolved: $table_unresolved
  score: $score
  delta: $delta
EOF

if [ "$has_fuzzy" = true ]; then
  cat <<EOF
  fuzzy: true
  dimensions:
    signal: $mean_s
    reversibility: $mean_r
    competence: $mean_a
    disambiguation: $mean_d
EOF
fi
