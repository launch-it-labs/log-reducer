# How it works: finding a bug in 2,604 lines of logs

This is a real scenario from our simulation. A batch job is leaking database connections.
The pool fills up, every API request starts failing with 503s, and the root cause is
buried 2,500 lines deep. Here's how an AI agent finds it — and what it costs.

## The setup

```
2,604 lines of application logs
~25,600 tokens if read raw
Bug: a nightly export batch is holding 30 DB connections and never releasing them
```

The log contains 45 minutes of normal traffic (health checks, DB queries, HTTP requests,
cache operations, metrics), then the batch job starts, the pool fills, and everything
breaks. The root cause — `Export batch still running (processed 45/2000, connections
held: 30)` — is a single line among 2,604.

## The conversation

```
┌─────────────────┐                    ┌──────────────────┐
│    AI Agent      │                    │  reduce_log tool  │
└────────┬────────┘                    └────────┬─────────┘
         │                                      │
         │  "The user says their API is          │
         │   returning 503s. Let me check        │
         │   the log."                           │
         │                                      │
         │                                      │
   ──────┤  STEP 1: SURVEY                      │
         │                                      │
         │  reduce_log({                        │
         │    file: "app.log",                  │
         │    summary: true                     │
         │  })                                  │
         │ ────────────────────────────────────> │
         │                                      │
         │  SUMMARY (2604 lines)                │
         │  Time span: 09:00:00 — 09:49:39      │
         │  Levels:                              │
         │    ERROR: 152 (09:47:30 — 09:48:59)  │
         │    WARN:    3 (09:47:00 — 09:47:20)  │
         │    INFO:  605 (09:00:00 — 09:48:05)  │
         │  Components: app.api, app.batch,      │
         │    app.db, app.cache, app.health      │
         │ <──────────────────────────────────── │
         │                                      │
         │  96 tokens. The AI now knows:         │
         │  - 152 errors starting at 09:47:30   │
         │  - 3 warnings right before at 09:47  │
         │  - There's a "batch" component       │
         │                                      │
         │                                      │
   ──────┤  STEP 2: SCAN                        │
         │                                      │
         │  reduce_log({                        │
         │    file: "app.log",                  │
         │    level: "error",                   │
         │    limit: 5, context: 3              │
         │  })                                  │
         │ ────────────────────────────────────> │
         │                                      │
         │  [showing 5 of 81 errors]             │
         │                                      │
         │  WARN [app.db] Connection pool near   │
         │    capacity (active=45/48/49)         │
         │  ERROR [app.db] Connection pool       │
         │    exhausted (active=50, idle=0)      │
         │  ERROR [app.api] GET /api/users/$551  │
         │    failed: ConnectionPoolExhausted    │
         │  ERROR [app.api] GET /api/orders/$552 │
         │    failed: ConnectionPoolExhausted    │
         │  ...                                  │
         │ <──────────────────────────────────── │
         │                                      │
         │  551 tokens. The AI now knows:        │
         │  - Pool went from 45 → 50 active     │
         │  - Then every API call failed         │
         │  - But WHY did the pool fill up?      │
         │                                      │
         │                                      │
   ──────┤  STEP 3: ZOOM                        │
         │                                      │
         │  reduce_log({                        │
         │    file: "app.log",                  │
         │    time_range: "09:47:25-09:48:10",  │
         │    before: 30                        │
         │  })                                  │
         │ ────────────────────────────────────> │
         │                                      │
         │  The 30 lines BEFORE the first error: │
         │                                      │
         │  Acquiring connection (active=26...)   │
         │  [app.batch] Processing record 17...  │
         │  Acquiring connection (active=27...)   │
         │  [app.batch] Processing record 18...  │
         │  ...                                  │
         │  Acquiring connection (active=39...)   │
         │  [app.batch] Processing record 30...  │
         │  [100 export queries]                 │
         │  WARN pool near capacity (45,48,49)   │
         │  ERROR pool exhausted (50, idle=0)    │
         │  ... cascade of 503s ...              │
         │                                      │
         │  *** THE CLUE ***                     │
         │  INFO [app.batch] Export batch still   │
         │    running (processed 45/2000,        │
         │    connections held: 30)              │
         │                                      │
         │ <──────────────────────────────────── │
         │                                      │
         │  ~1,350 tokens. The AI sees the       │
         │  batch job acquiring connections and   │
         │  never releasing them. Hypothesis      │
         │  forming.                             │
         │                                      │
         │                                      │
   ──────┤  STEP 4: TRACE                       │
         │                                      │
         │  reduce_log({                        │
         │    file: "app.log",                  │
         │    grep: "active=|idle=|batch|held", │
         │    time_range: "09:45-09:48:30",     │
         │    limit: 15, context: 0             │
         │  })                                  │
         │ ────────────────────────────────────> │
         │                                      │
         │  Acquiring connection (active=11...)   │
         │  Acquiring connection (active=12...)   │
         │  ...                                  │
         │  Acquiring connection (active=25...)   │
         │                                      │
         │  A perfect staircase: 11 → 12 → ...  │
         │  → 25. The batch job is eating one    │
         │  connection per record and never      │
         │  giving it back.                      │
         │ <──────────────────────────────────── │
         │                                      │
         │  186 tokens. Root cause confirmed.     │
         │                                      │
         ▼                                      ▼
```

## The AI's conclusion

> The nightly export batch job (started at 09:45:00) is leaking database connections.
> It acquired 30 connections while processing records 1-30 of 2,000 and never released
> them. Combined with the existing 20 active connections from normal traffic, this
> exhausted the pool (50/50) at 09:47:30, causing all API requests to fail with 503.
>
> Fix: the batch job needs to release connections after each record, or use a single
> connection with a cursor.

**Four calls. Root cause found. The raw log never entered the conversation.**

## What it cost

```
                          Tokens     % of raw    Signal-to-noise
                       ─────────────────────────────────────────
Without log reducer
  AI reads full log      25,600      100%            4%
                       ─────────────────────────────────────────
With log reducer (one-shot)
  reduce_log (no filters) 16,500      64%            4%
                       ─────────────────────────────────────────
With log reducer (funnel)
  Step 1  SURVEY             96
  Step 2  SCAN              551
  Step 3  ZOOM            1,350
  Step 4  TRACE             186
                         ──────
  Total                   2,183        9%           18%
```

The funnel pattern used **9% of the tokens** to find the same root cause, with
**4.5x better signal concentration**. The other 91% of the context window is
available for the AI to think, write code, and help you fix the bug.

### Where the tokens go

This is the part that makes the difference concrete. An AI context window is
fixed — every token spent on logs is a token *not* spent on reasoning.

```
Without log reducer:                With log reducer:

┌─────────────────────────┐        ┌─────────────────────────┐
│                         │        │                         │
│    25,600 tokens of     │        │   2,183 tokens of       │
│    raw log (mostly      │        │   targeted signal       │
│    noise — health       │        │                         │
│    checks, debug spam,  │        ├─────────────────────────┤
│    cache ops, access    │        │                         │
│    logs, metrics...)    │        │   23,417 tokens free    │
│                         │        │   for reasoning, code   │
│                         │        │   generation, and       │
│                         │        │   conversation          │
│                         │        │                         │
│                         │        │                         │
│                         │        │                         │
│                         │        │                         │
│                         │        │                         │
└─────────────────────────┘        └─────────────────────────┘
 Context window                     Context window
 (nearly full with noise)           (91% free for real work)
```

Those 23,400 freed tokens are roughly:

- **15-20 more back-and-forth exchanges** with the user
- **~600 lines of generated code** the AI can write
- **The difference** between the AI solving the problem in this session
  vs. running out of context and losing its train of thought

### Across 5 simulated bugs

We ran this against 5 different production bug scenarios (pool exhaustion, auth
cascade, memory leak, deployment crash, race condition):

```
                       Tokens     vs. raw
                    ──────────────────────
Raw (no tool)        116,821     baseline
Naive reduce_log      69,287     -41%
Funnel pattern         5,038     -96%
```

The funnel pattern found every root cause while using **4.3% of raw tokens**.
It concentrated bug-relevant signal **16x** compared to reading the raw log.

---

*These numbers come from `test/simulation/sim.ts`. Run `node out/test/simulation/sim.js`
to reproduce.*
