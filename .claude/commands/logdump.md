The user has a log on their clipboard. Dump it to a temp file and reduce it using the
filters most relevant to your current debugging context.

**Step 1 — Save clipboard to file (do NOT read the file contents):**

```
powershell -command "Get-Clipboard | Set-Content C:\tmp\log.txt"
```

**Step 2 — Call reduce_log with the filters YOU need right now:**

```
reduce_log({ file: "C:\\tmp\\log.txt", tail: 200, ... })
```

Choose the filters based on what you're currently investigating:
- Debugging an error? Use `level: "error"` or `level: "warning"`
- Looking at a specific component? Use `component: "name"`
- Searching for a pattern? Use `grep: "pattern"`
- Narrow time window? Use `time_range: "HH:MM-HH:MM"`
- Need more context around matches? Increase `context` (default 3)

Always include `tail`. Default to `tail: 200` unless you need more.

**Step 3 — If the threshold gate fires (output exceeds token limit):**

Re-call with a `query` param describing what you're investigating:

```
reduce_log({ file: "C:\\tmp\\log.txt", tail: 2000, query: "describe your current investigation" })
```

Write the query based on the conversation context — what is the user trying to debug?
This uses an LLM to extract only the relevant log lines (~200 tokens).

**The raw log must NEVER enter the conversation.** Do not read C:\tmp\log.txt with the
Read tool. Only the reduce_log output should appear in this conversation.

Show the reduced output to the user.
