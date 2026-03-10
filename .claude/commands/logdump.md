The user has a log on their clipboard. Dump it to a temp file and reduce it using the
filters most relevant to your current debugging context.

**Step 1 — Save clipboard to file (do NOT read the file contents):**

```
powershell -command "Get-Clipboard | Set-Content C:\tmp\log.txt"
```

**Step 2 — Call reduce_log with the filters YOU need right now:**

```
reduce_log({ file: "C:\\tmp\\log.txt", tail: 2000 })
```

Start with just `tail` — no filters. If the output is small enough, you get it directly.
If it's large, you automatically get an enhanced summary listing unique errors, warnings,
timestamps, and components. Use that summary to plan your next call.

**Step 3 — Drill down based on what you see:**

After the initial call, narrow with the filters that match your investigation:
- Debugging an error? Use `level: "error"` or `level: "warning"`
- Looking at a specific component? Use `component: "name"`
- Searching for a pattern? Use `grep: "pattern"`
- Narrow time window? Use `time_range: "HH:MM-HH:MM"`
- Need more context around matches? Use `before: 30` or `after: 10`
- Context window too noisy? Add `context_level: "warning"` to filter low-severity context lines

Example follow-up calls:
```
reduce_log({ file: "C:\\tmp\\log.txt", tail: 2000, level: "error", limit: 5 })
reduce_log({ file: "C:\\tmp\\log.txt", tail: 2000, time_range: "14:02-14:03", before: 50 })
reduce_log({ file: "C:\\tmp\\log.txt", tail: 2000, level: "error", before: 30, context_level: "warning" })
```

**The raw log must NEVER enter the conversation.** Do not read C:\tmp\log.txt with the
Read tool. Only the reduce_log output should appear in this conversation.

Show the reduced output to the user.
