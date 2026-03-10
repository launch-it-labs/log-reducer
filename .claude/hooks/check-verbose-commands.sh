#!/bin/bash
# PreToolUse hook for Bash: intercepts known-verbose commands that would dump
# raw output into AI context. Blocks the call and suggests the safe redirect form.
#
# Install: copy to .claude/hooks/ and add to .claude/settings.json:
#   "hooks": { "PreToolUse": [{ "matcher": "Bash",
#     "hooks": [{ "type": "command", "command": "bash .claude/hooks/check-verbose-commands.sh" }] }] }

INPUT=$(cat)

# Extract the command from the JSON tool input
COMMAND=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('command', ''))
except:
    pass
" 2>/dev/null)

# Already redirecting output to a file — safe, let it through
if echo "$COMMAND" | grep -qE '>[>&]?\s*\S+'; then
  exit 0
fi

# Known-verbose commands that reliably produce >20 lines of output
if echo "$COMMAND" | grep -qE '^\s*(npm\s+(test|run|install|ci)\b|yarn\s+(test|install)\b|pytest\b|python\s+-m\s+pytest\b|npx\s+playwright\b|pip\s+install\b|docker\s+(build|compose\s+up)\b|docker-compose\s+up\b|mvn\s+(test|package|install)\b|gradle\s+(test|build)\b|cargo\s+(test|build)\b|go\s+test\b|make\b)'; then
  echo "BLOCKED: This command produces verbose output that would consume tokens in context."
  echo ""
  echo "Redirect to a file instead:"
  echo "  ${COMMAND} > /tmp/cmd-output.log 2>&1; echo \"exit: \$?\""
  echo ""
  echo "Then reduce it: reduce_log({ file: \"/tmp/cmd-output.log\", tail: 2000 })"
  exit 2
fi
