# Branch Auditor Report: main01 evidence contradiction repair

Date: 2026-06-16
Repository: `/Volumes/App_Dev/new_Prompt_prj`
Observed branch: `main01`
Scope: read-only branch/ref audit for `main01`, `origin/main01`, `origin/main`, local `main`, backup branches, push/merge risk, and untracked report handling.
Hard status: `FAIL`

## Boundaries

- Did not read `真实配置.json`.
- Did not edit source code, Git config, branches, refs, index, or existing reports.
- Did not run `git fetch`, `git pull`, `git push`, `git merge`, `git switch`, `git checkout`, `git add`, or `git commit`.
- Used `git ls-remote` for remote evidence without updating local remote-tracking refs.
- Wrote only this report file.

## Hard Status Rules

Only these hard statuses are used in this report:

- `PASS_GIT_HYGIENE`
- `FAIL`
- `UNVERIFIED`
- `BLOCKED`

## Executive Decision

Overall hard status: `FAIL`

Reason: `main01` itself is clean against `origin/main01`, and at least one exact backup branch exists, but local `main` is ahead of `origin/main` by four commits while the remote default branch is `main`. That creates a concrete main push/merge hygiene risk if an operator runs an unqualified push/merge from local `main` or uses local `main` as if it were remote `main`. The working tree also contains untracked report artifacts that are explicitly trackable by `.gitignore`, so they need an explicit owner decision instead of being ignored as runtime noise.

## Ref Evidence

| Check | Hard status | Evidence |
| --- | --- | --- |
| Current branch is `main01`. | `PASS_GIT_HYGIENE` | `git branch --show-current` returned `main01`. |
| `main01` tracks `origin/main01`. | `PASS_GIT_HYGIENE` | `git status --porcelain=v2 --branch --untracked-files=all` reported `branch.head main01`, `branch.upstream origin/main01`, and `branch.ab +0 -0`. `.git/config` contains `branch.main01.remote origin` and `branch.main01.merge refs/heads/main01`. |
| Local `main01` equals local `origin/main01`. | `PASS_GIT_HYGIENE` | `git show-ref refs/heads/main01 refs/remotes/origin/main01` returned `6b7c9c8700245e9abf1781e6ab0de696f92ae955` for both; `git rev-list --left-right --count main01...origin/main01` returned `0 0`. |
| Remote `main01` equals local `main01`. | `PASS_GIT_HYGIENE` | `git ls-remote --heads origin main main01` returned remote `main01` at `6b7c9c8700245e9abf1781e6ab0de696f92ae955`, matching local `main01`. |
| Remote default branch is `main`. | `PASS_GIT_HYGIENE` | `git ls-remote --symref origin HEAD` returned `ref: refs/heads/main HEAD`. |
| Local `origin/main` matches remote `main`. | `PASS_GIT_HYGIENE` | Local `origin/main` is `751b3013a0526f031c04d08946516d5e46cb6a01`; `git ls-remote --heads origin main` returned remote `main` at the same hash. |
| Local `main` does not match `origin/main`. | `FAIL` | Local `main` is `a77c15fa40f39adaf1c77a6e100f5da354f0b64c`; `origin/main` is `751b3013a0526f031c04d08946516d5e46cb6a01`; `git rev-list --left-right --count main...origin/main` returned `4 0`. |
| `main01` contains `origin/main`. | `PASS_GIT_HYGIENE` | `git merge-base --is-ancestor origin/main main01` exited `0`; `git rev-list --left-right --count main01...origin/main` returned `7 0`. |
| Local `main` is not an ancestor of `main01`. | `FAIL` | `git merge-base --is-ancestor main main01` exited `1`; `git rev-list --left-right --count main01...main` returned `7 4`. |

## Main Push / Merge Risk

Hard status: `FAIL`

- Safe part: pushing the current branch with an explicit refspec such as `main01:main01` would target `origin/main01`, and current `main01` already matches remote `main01`.
- Risk part: remote `HEAD` points to `main`, while local `main` is four commits ahead of `origin/main`. A plain operation from local `main`, or a merge/rebase decision that treats local `main` as equivalent to `origin/main`, can change or contaminate the remote default branch.
- Additional risk: `branch.main01.vscode-merge-base` is configured as `origin/main`, while `branch.main01.merge` is `refs/heads/main01`. Tooling that keys off the VS Code merge-base may show `main01` against `origin/main` even though Git upstream is `origin/main01`; that is not a push target by itself, but it can confuse review intent.

## Backup Branch Evidence

Hard status: `PASS_GIT_HYGIENE`

Local backup branches exist:

```text
backup/main01-before-evidence-contradiction-repair-20260616001001 6b7c9c8
backup/main01-before-evidence-security-repair-20260615213049 b296d6d
backup/main01-before-full-repair-20260615175420 030fbb8
backup/main01-before-screenshot-report-repair-20260615234536 3a51240
backup/main01-unsafe-before-security-redaction-20260615172134 3b4f2da
backup/main01-unsafe-branch-name-preserved-202606151735 3b4f2da
backup/uncommitted-before-main01-20260615171132 e924310
```

Most important current backup:

- `backup/main01-before-evidence-contradiction-repair-20260616001001` equals current `main01` exactly at `6b7c9c8700245e9abf1781e6ab0de696f92ae955`.
- `git rev-list --left-right --count main01...backup/main01-before-evidence-contradiction-repair-20260616001001` returned `0 0`.

Older backups are present and intentionally behind or divergent:

```text
main01...backup/main01-before-evidence-security-repair-20260615213049 4 0
main01...backup/main01-before-full-repair-20260615175420 5 0
main01...backup/main01-before-screenshot-report-repair-20260615234536 2 0
main01...backup/main01-unsafe-before-security-redaction-20260615172134 7 11
main01...backup/main01-unsafe-branch-name-preserved-202606151735 7 11
main01...backup/uncommitted-before-main01-20260615171132 7 6
```

## Working Tree And Untracked Report Handling

Hard status: `FAIL`

Early audit sampling with `git status --porcelain=v2 --branch --untracked-files=all` reported no tracked file modifications and reported untracked files under `.codex-agent-team/reports/`. Final post-report verification observed additional tracked modifications in existing report/evidence files. Those tracked modifications were not edited or repaired by this Branch Auditor run, and they keep the branch hygiene decision at `FAIL`.

The relevant untracked report set observed in this audit includes:

```text
.codex-agent-team/reports/browser-qa-20260615.md
.codex-agent-team/reports/code-reviewer-20260615.md
.codex-agent-team/reports/contract-reviewer-20260615.md
.codex-agent-team/reports/evidence-auditor-main01-evidence-contradiction-repair-20260616.md
.codex-agent-team/reports/final-integrator-20260615.md
.codex-agent-team/reports/final-integrator-main01-post-push-template-20260615.md
.codex-agent-team/reports/git-hygiene-reviewer-main01-evidence-contradiction-repair-20260616.md
.codex-agent-team/reports/provider-base64-receive-and-browser-rerun-20260615.md
.codex-agent-team/reports/provider-config-reviewer-20260615.md
.codex-agent-team/reports/provider-poll-url-subagent-summary-20260615.md
.codex-agent-team/reports/review-T1-final-image-api-service.json
.codex-agent-team/reports/review-T1-final-image-api-service.md
.codex-agent-team/reports/review-T1-provider-stability-post-merge.json
.codex-agent-team/reports/review-ai-tu-prompt-optimizer-ui.json
.codex-agent-team/reports/screenshot-security-reviewer-main01-evidence-contradiction-repair-20260616.md
.codex-agent-team/reports/security-reviewer-20260615.md
.codex-agent-team/reports/security-reviewer-main01-evidence-contradiction-repair-20260616.md
.codex-agent-team/reports/test-reviewer-main01-evidence-contradiction-repair-20260616.md
```

Handling decision:

- Do not treat these files as ignored runtime artifacts. `git check-ignore -v` reports `.gitignore:14:!.codex-agent-team/reports/**` for sampled files, so normal report files are explicitly re-included and trackable.
- Do not delete, revert, or auto-stage them in this audit. This role is read-only except for this report.
- Required next owner action is explicit triage: either include intended audit/review reports in the evidence-chain commit, or move/remove intentionally local drafts under a path that is actually ignored. Existing tracked modifications also need owner review before any push. Until that decision is made, branch hygiene remains `FAIL`.

Final post-report `git status --short --branch --untracked-files=all` also showed tracked modifications under:

```text
.codex-agent-team/reports/
evidence/visual-e2e-report.md
```

This final-status change does not alter the branch-ref findings above, but it strengthens the `FAIL` decision for working-tree hygiene.

## Commands Run

```bash
git status --short --branch --untracked-files=all
git branch --show-current
git remote
git config --show-origin --get-regexp '^(branch\.main01\.|branch\.main\.|push\.default|remote\.pushDefault|branch\.main01\.pushRemote|branch\.main\.pushRemote|remote\.origin\.pushurl|remote\.origin\.url)'
git ls-remote --heads origin main main01
git branch --list '*backup*' '*bak*' '*main01*' '*main*'
git show-ref --heads --tags --dereference
git show-ref --heads refs/heads/main refs/heads/main01 refs/heads/backup/main01-before-evidence-contradiction-repair-20260616001001 refs/heads/backup/main01-before-evidence-security-repair-20260615213049 refs/heads/backup/main01-before-full-repair-20260615175420 refs/heads/backup/main01-before-screenshot-report-repair-20260615234536 refs/heads/backup/main01-unsafe-before-security-redaction-20260615172134 refs/heads/backup/main01-unsafe-branch-name-preserved-202606151735 refs/heads/backup/uncommitted-before-main01-20260615171132
git show-ref refs/remotes/origin/main refs/remotes/origin/main01
git log --oneline --decorate --graph --max-count=30 --all --exclude='refs/heads/backup/*' --exclude='refs/remotes/*/HEAD'
git rev-list --left-right --count main01...origin/main01
git rev-list --left-right --count main...origin/main
git rev-list --left-right --count main01...origin/main
git rev-list --left-right --count main01...main
git merge-base --is-ancestor origin/main main01
git merge-base --is-ancestor origin/main main
git merge-base --is-ancestor main origin/main
git merge-base --is-ancestor main main01
git log --oneline --decorate --left-right --cherry-pick main...origin/main
git ls-remote --symref origin HEAD
git status --porcelain=v2 --branch --untracked-files=all
git check-ignore -v <sampled untracked report paths>
find .codex-agent-team/reports -maxdepth 1 -type f \( -name '*20260615*' -o -name '*20260616*' -o -name 'review-T1-*' -o -name 'review-ai-tu-*' \) -print0 | xargs -0 ls -lT
git status --short --branch --untracked-files=all
```

## Final Hard Status

`FAIL`

`main01` / `origin/main01` is clean, and backup coverage exists, but this audit cannot mark the repository `PASS_GIT_HYGIENE` because local `main` is ahead of `origin/main` by four commits while `origin/HEAD` points to `main`, because trackable untracked report files remain unresolved, and because final post-report verification shows existing tracked report/evidence modifications that need owner review.
