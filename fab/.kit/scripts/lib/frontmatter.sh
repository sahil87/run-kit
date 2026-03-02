# fab/.kit/scripts/lib/frontmatter.sh — Shared YAML frontmatter parser
#
# Sourceable library. No shebang, no set -euo pipefail.
# Usage: source "$kit_dir/scripts/lib/frontmatter.sh"

# Extract a field value from YAML frontmatter (between --- markers).
# Usage: frontmatter_field <file> <field_name>
# Returns the value (unquoted) or empty string if not found.
frontmatter_field() {
  local file="$1" field="$2"
  sed -n '
    /^---$/,/^---$/{
      /^---$/d
      /^'"$field"': */{
        s/^'"$field"': *//
        s/^"//; s/"$//
        s/ *#.*//
        p
        q
      }
    }
  ' "$file"
}

# Extract a field value from shell-comment frontmatter (between # --- markers).
# Usage: shell_frontmatter_field <file> <field_name>
# Returns the value (unquoted) or empty string if not found.
shell_frontmatter_field() {
  local file="$1" field="$2"
  sed -n '
    /^# ---$/,/^# ---$/{
      /^# ---$/d
      /^# *'"$field"': */{
        s/^# *'"$field"': *//
        s/^"//; s/"$//
        s/ *#.*//
        p
        q
      }
    }
  ' "$file"
}
