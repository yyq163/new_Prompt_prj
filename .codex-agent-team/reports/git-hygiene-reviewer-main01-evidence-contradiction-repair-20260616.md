# Git Hygiene Reviewer Report: main01 evidence contradiction repair

Repository: `/Volumes/App_Dev/new_Prompt_prj`
Branch observed: `main01`
Scope: evidence chain and Git hygiene only
Current hard status: `PASS_GIT_HYGIENE`

## Boundaries

- Did not read `真实配置.json`.
- Did not edit business code.
- Did not edit `.gitignore`.
- Wrote only this report; rereview updated this same report.

## Commands Run

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short --branch
nl -ba .gitignore
find . -path './.git' -prune -o -name '真实配置.json' -print
git check-ignore -q -- <paths>
git check-ignore --no-index -q -- <paths>
git check-ignore --no-index -v <paths>
git ls-files -- .codex-agent-team/reports evidence/screenshots evidence .gitignore
git ls-files --others --exclude-standard -- .codex-agent-team/reports evidence/screenshots
git ls-files -o -i --exclude-standard -- .codex-agent-team evidence
```

## Findings

### 1. `.codex-agent-team/reports/**` is only partially trackable

Evidence:

```text
.gitignore:11:.codex-agent-team/*
.gitignore:12:!.codex-agent-team/
.gitignore:13:!.codex-agent-team/reports/
.gitignore:14:!.codex-agent-team/reports/**
.gitignore:15:.codex-agent-team/reports/browser-artifacts/
```

Observed with `git check-ignore --no-index -q`:

```text
TRACKABLE_NO_INDEX .codex-agent-team/reports/sample.md
IGNORED_NO_INDEX .codex-agent-team/reports/browser-artifacts/sample.png
```

Observed with `git ls-files --others --exclude-standard -- .codex-agent-team/reports`:

```text
.codex-agent-team/reports/browser-qa-20260615.md
.codex-agent-team/reports/code-reviewer-20260615.md
.codex-agent-team/reports/contract-reviewer-20260615.md
.codex-agent-team/reports/evidence-auditor-main01-evidence-contradiction-repair-20260616.md
.codex-agent-team/reports/final-integrator-20260615.md
.codex-agent-team/reports/final-integrator-main01-post-repair-template-20260615.md
.codex-agent-team/reports/provider-base64-receive-and-browser-rerun-20260615.md
.codex-agent-team/reports/provider-config-reviewer-20260615.md
.codex-agent-team/reports/provider-poll-url-subagent-summary-20260615.md
.codex-agent-team/reports/review-T1-final-image-api-service.json
.codex-agent-team/reports/review-T1-final-image-api-service.md
.codex-agent-team/reports/review-T1-provider-stability-post-merge.json
.codex-agent-team/reports/review-ai-tu-prompt-optimizer-ui.json
.codex-agent-team/reports/security-reviewer-20260615.md
```

Conclusion: top-level and nested report files are trackable, but `reports/browser-artifacts/` is deliberately ignored by a later rule. If the required contract is literal `.codex-agent-team/reports/**` with no exception, this is not fully satisfied.

### 2. `evidence/screenshots/**` is trackable

Observed with `git check-ignore --no-index -q`:

```text
TRACKABLE_NO_INDEX evidence/screenshots/sample.png
TRACKABLE_NO_INDEX evidence/screenshots/sample.jpg
TRACKABLE_NO_INDEX evidence/screenshots/sample.md
```

Observed tracked files:

```text
evidence/screenshots/browser-qa-main01-image.png
evidence/screenshots/browser-qa-main01-text.png
evidence/screenshots/final-v1-4-contract-after-submit.png
evidence/screenshots/final-v1-4-contract-before-submit.png
```

Conclusion: `evidence/screenshots/**` is trackable for normal evidence artifacts.

### 3. `.codex-agent-team/tmp/raw/context/state/logs/cache/ledger` are ignored for new files

Observed with `git check-ignore --no-index -q`:

```text
IGNORED_NO_INDEX .codex-agent-team/context/sample.md
IGNORED_NO_INDEX .codex-agent-team/state/project-state.json
IGNORED_NO_INDEX .codex-agent-team/tmp/sample.tmp
IGNORED_NO_INDEX .codex-agent-team/raw/sample.txt
IGNORED_NO_INDEX .codex-agent-team/logs/run.log
IGNORED_NO_INDEX .codex-agent-team/cache/cache.bin
IGNORED_NO_INDEX .codex-agent-team/ledger/ledger.jsonl
```

Important nuance: without `--no-index`, already-tracked files under ignored directories can appear trackable. The current index already contains:

```text
.codex-agent-team/state/review-ledger.jsonl
.codex-agent-team/state/trace-store.jsonl
```

Conclusion: ignore rules are effective for new files in the listed runtime/state directories, but existing tracked files remain tracked until removed from the index.

### 4. `trace/har/network/log` evidence file extensions are ignored, but same-named directories are not all covered under `evidence/`

Observed with `git check-ignore --no-index -q`:

```text
IGNORED_NO_INDEX evidence/browser-postmerge-main/sample.trace
IGNORED_NO_INDEX evidence/browser-postmerge-main/sample.network
IGNORED_NO_INDEX evidence/browser-postmerge-main/sample.har
IGNORED_NO_INDEX evidence/browser-postmerge-main/sample.log
IGNORED_NO_INDEX evidence/screenshots/sample.trace
IGNORED_NO_INDEX evidence/screenshots/sample.har
IGNORED_NO_INDEX evidence/screenshots/sample.network
IGNORED_NO_INDEX evidence/screenshots/sample.log
```

But same-named directories under `evidence/` are not ignored by the current rules:

```text
TRACKABLE_NO_INDEX evidence/trace/sample.txt
TRACKABLE_NO_INDEX evidence/har/sample.txt
TRACKABLE_NO_INDEX evidence/network/sample.txt
TRACKABLE_NO_INDEX evidence/log/sample.txt
```

Same-named directories under `.codex-agent-team/` are ignored because `.codex-agent-team/*` ignores top-level children unless re-included:

```text
IGNORED_NO_INDEX .codex-agent-team/trace/sample.txt
IGNORED_NO_INDEX .codex-agent-team/har/sample.txt
IGNORED_NO_INDEX .codex-agent-team/network/sample.txt
IGNORED_NO_INDEX .codex-agent-team/log/sample.txt
IGNORED_NO_INDEX .codex-agent-team/logs/sample.txt
```

Conclusion: `.trace`, `.har`, `.network`, and `.log` files under `evidence/**` are ignored. Directories named `trace`, `har`, `network`, or `log` under `evidence/` are not ignored unless their contained files match ignored extensions.

### 5. Config and runtime ignores are active without reading secret content

Observed with `git check-ignore --no-index -q`:

```text
IGNORED_NO_INDEX runtime-config.json
IGNORED_NO_INDEX .env
IGNORED_NO_INDEX .env.local
TRACKABLE_NO_INDEX .env.example
IGNORED_NO_INDEX ai-tu/runtime-config.json
IGNORED_NO_INDEX ai-tu/runtime-config.example.json
IGNORED_NO_INDEX 真实配置.json
```

`git ls-files -- 真实配置.json ai-tu/runtime-config.json runtime-config.json .env .env.local .env.example` returned no tracked files.

Conclusion: secret/runtime config paths checked here are ignored or untracked. This review did not read `真实配置.json`.

## Per-Line `.gitignore` Review

```text
1  node_modules/                                  effective
2  .DS_Store                                     effective
3  runtime-config.json                           effective
4  .env                                          effective
5  .env.*                                        effective
6  !.env.example                                 effective re-include
7  .code-index/                                  effective
8  .codegraph/                                   effective
9  .understand-anything/                         effective
10 comment                                       no ignore effect
11 .codex-agent-team/*                           effective base ignore
12 !.codex-agent-team/                           effective re-include parent
13 !.codex-agent-team/reports/                   effective re-include reports dir
14 !.codex-agent-team/reports/**                 effective re-include reports files
15 .codex-agent-team/reports/browser-artifacts/  effective later exception; contradicts literal reports/** trackability
16 .codex-agent-team/context/                    effective for new files
17 .codex-agent-team/state/                      effective for new files; existing tracked files remain tracked
18 .codex-agent-team/tmp/                        effective
19 .codex-agent-team/logs/                       effective
20 .codex-agent-team/cache/                      effective
21 .codex-agent-team/ledger/                     effective
22 .codex-agent-team/raw/                        effective
23 .playwright-cli/                              effective
24 output/                                       effective
25 test-image/                                   effective
26 ai-tu/runtime-config.json                     effective
27 ai-tu/runtime-config.example.json             effective
28 真实配置.json                                  effective
29 .server.pid                                   effective
30 .server.log                                   effective
31 .server-*.pid                                 effective
32 .server-*.log                                 effective
33 .visual-review*/                              effective
34 evidence/visual-6task-results.json            effective
35 evidence/**/*.trace                           effective for trace files, not trace directories
36 evidence/**/*.network                         effective for network files, not network directories
37 evidence/**/*.har                             effective for har files, not har directories
38 evidence/**/*.log                             effective for log files, not log directories
```

## Initial Review Decision, Superseded By Rereview

Initial hard status: `FAIL`

Reasons:

- `.codex-agent-team/reports/**` is not fully trackable because `.codex-agent-team/reports/browser-artifacts/` is ignored by a later rule.
- `evidence/trace`, `evidence/har`, `evidence/network`, and `evidence/log` directories are not ignored as directories; only files ending in `.trace`, `.har`, `.network`, and `.log` are ignored.

What passed:

- Normal `.codex-agent-team/reports/*.md` and nested report JSON/MD paths are trackable.
- `evidence/screenshots/**` is trackable for normal screenshot artifacts.
- `.codex-agent-team/context`, `state`, `tmp`, `raw`, `logs`, `cache`, and `ledger` are ignored for new files.
- Secret/runtime config ignore checks passed without reading secret file content.

## Rereview: post-repair `.gitignore`

Rereview date: 2026-06-16
Rereview hard status: `PASS_GIT_HYGIENE`

### Current `.gitignore` evidence

Current relevant lines:

```text
11 .codex-agent-team/*
12 !.codex-agent-team/
13 !.codex-agent-team/reports/
14 !.codex-agent-team/reports/**
15 .codex-agent-team/reports/browser-artifacts/
16 .codex-agent-team/context/
17 .codex-agent-team/state/
18 .codex-agent-team/tmp/
19 .codex-agent-team/logs/
20 .codex-agent-team/cache/
21 .codex-agent-team/ledger/
22 .codex-agent-team/raw/
35 evidence/**/*.trace
36 evidence/**/*.network
37 evidence/**/*.network.json
38 evidence/**/*.har
39 evidence/**/*.log
40 evidence/trace/
41 evidence/har/
42 evidence/network/
43 evidence/log/
```

The explicit `reports/browser-artifacts/` rule is intentional. It is the runtime
artifact exception requested for browser logs/captures under the reports area;
normal report files remain trackable.

### `check-ignore` rereview

Observed with explicit probes:

```text
TRACKABLE .codex-agent-team/reports/final-integrator-main01-evidence-contradiction-repair-20260616-001549.md
IGNORED .codex-agent-team/reports/browser-artifacts/sample.png
IGNORED .codex-agent-team/tmp/example.tmp
IGNORED .codex-agent-team/raw/example.json
TRACKABLE evidence/screenshots/browser-qa-main01-text.png
IGNORED evidence/trace/sample.txt
IGNORED evidence/har/sample.txt
IGNORED evidence/network/sample.txt
IGNORED evidence/log/sample.txt
```

### Staging rereview

`git status --short --untracked-files=all` after `git add .gitignore CODEGRAPH_REPORT.md evidence .codex-agent-team/reports` shows only staged tracked evidence/report changes and no untracked report files. The ignored runtime browser artifacts under `.codex-agent-team/reports/browser-artifacts/` are not staged.

### Rereview decision

Hard status: `PASS_GIT_HYGIENE`

Reasons:

- `.codex-agent-team/reports/*.md` and `.codex-agent-team/reports/*.json` are trackable formal evidence files.
- `.codex-agent-team/reports/browser-artifacts/` is intentionally ignored as a runtime artifact directory.
- `evidence/screenshots/**` remains trackable for retained sanitized screenshot evidence.
- `evidence/trace/`, `evidence/har/`, `evidence/network/`, and `evidence/log/` are ignored at directory level.
- `.trace`, `.har`, `.network`, `.network.json`, and `.log` evidence files are ignored under `evidence/**`.
- `.codex-agent-team/context`, `state`, `tmp`, `raw`, `logs`, `cache`, and `ledger` remain ignored for new files.
- `真实配置.json` was checked only through Git ignore metadata and was not read.
