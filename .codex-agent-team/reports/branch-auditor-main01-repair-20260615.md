# Branch Auditor Report — main01 Repair Inspection

**Repository:** `/Volumes/App_Dev/new_Prompt_prj`  
**Current branch:** `main01`  
**HEAD:** `b296d6d0f4a5ded914c489a7f3e3e2d77fa2c17f`  
**Generated:** 2026-06-15T21:29:03+08:00  
**Auditor:** Branch Auditor (read-only)

---

## 1. Ref Table

| Ref | Short SHA | Full SHA | Notes |
|-----|-----------|----------|-------|
| `HEAD` | `b296d6d` | `b296d6d0f4a5ded914c489a7f3e3e2d77fa2c17f` | Points to `refs/heads/main01` |
| `main` | `a77c15f` | `a77c15fa40f39adaf1c77a6e100f5da354f0b64c` | Local branch only |
| `origin/main` | `751b301` | `751b3013a0526f031c04d08946516d5e46cb6a01` | Remote-tracking branch |
| `main01` | `b296d6d` | `b296d6d0f4a5ded914c489a7f3e3e2d77fa2c17f` | Local branch |
| `origin/main01` | `b296d6d` | `b296d6d0f4a5ded914c489a7f3e3e2d77fa2c17f` | Remote-tracking branch |
| `backup/main01-before-evidence-security-repair-20260615213049` | `b296d6d` | `b296d6d0f4a5ded914c489a7f3e3e2d77fa2c17f` | Matches `main01` tip |
| `backup/main01-before-full-repair-20260615175420` | `030fbb8` | `030fbb8770f2cd0663a9ffc90fc1d971ea9a77c8` | |
| `backup/main01-unsafe-before-security-redaction-20260615172134` | `3b4f2da` | `3b4f2da3b84001c82e007d09c54b807142a116aa` | Contains old `main` merge |
| `backup/main01-unsafe-branch-name-preserved-202606151735` | `3b4f2da` | `3b4f2da3b84001c82e007d09c54b807142a116aa` | Contains old `main` merge |
| `backup/uncommitted-before-main01-20260615171132` | `e924310` | `e924310d494cda940506a056be940b4654f95e28` | |

---

## 2. Branch Relationship Checks

### 2.1 `main01` vs `origin/main01`

- **Local `main01`:** `b296d6d`
- **Remote `origin/main01`:** `b296d6d`
- **Commits ahead of remote:** `0`
- **Commits behind remote:** `0`
- **Verdict:** ✅ `main01` is exactly in sync with `origin/main01`.

### 2.2 `main` vs `origin/main`

- **Local `main`:** `a77c15f`
- **Remote `origin/main`:** `751b301`
- **Commits ahead of `origin/main`:** `4`
- **Commits behind `origin/main`:** `0`
- **Common ancestor:** `751b301` (`origin/main` is an ancestor of local `main`)

The 4 local-only commits on `main` are:

```
a77c15f Merge ragflow knowledge-driven template
4ababd5 harden ragflow enhancement validation
669859f fix ragflow template evidence chain
a81d630 refactor prompt compiler for ragflow knowledge templates
```

- **Verdict:** ⚠️ Local `main` is **4 commits ahead** of `origin/main` and has **not** been pushed to `origin/main`.

### 2.3 Cross-branch ancestry

- `main01` contains `main`? **No** (verified with `merge-base --is-ancestor`).
- `main` contains `main01`? **No**.
- Common ancestor of `main` and `main01`: `751b301` (`origin/main`).
- **Verdict:** ✅ Current `main01` does not include the 4 local `main` commits; no merge of `main` into `main01` is present.

---

## 3. Push / Merge Evidence Check

### 3.1 Was `main` pushed to `origin/main`?

- `origin/main` remains at `751b301`, which is the 4th ancestor of local `main`.
- No remote ref (`git branch -r`) points to `a77c15f` or any of the 4 local `main` commits as the tip of `origin/main`.
- `origin/main` reflog ends at `751b301` (`update by push`); it does **not** record `a77c15f`.
- **Verdict:** ✅ No evidence that the current local `main` (`a77c15f`) has been pushed to `origin/main`.

### 3.2 Was `main` merged into `main01`?

- `main01` HEAD (`b296d6d`) does **not** have `a77c15f` (the `main` merge commit) in its ancestry.
- The merge commit `a77c15f` only appears on:
  - Local `main`
  - Local `merge-candidate/provider-stability-20260615-main-a77c15f`
  - Historical `backup/main01-unsafe-*` snapshots (pre-redaction)
- **Verdict:** ✅ No evidence that current `main` has been merged into current `main01`.

### 3.3 Caveat — remote feature branches

Two remote feature branches (`origin/codex/provider-stability-post-merge` and `origin/codex/provider-edits-debug-base64-fix`) are descendants of `a77c15f`. This indicates those feature branches were created from local `main` at `a77c15f` and pushed, but it does **not** mean `origin/main` itself was advanced or that `main01` merged `main`.

---

## 4. Protection Status

| Item | Status |
|------|--------|
| `main01` ↔ `origin/main01` | ✅ In sync |
| Local `main` pushed to `origin/main` | ❌ Not pushed (4 commits local-only) |
| `main` merged into `main01` | ❌ Not merged into current `main01` |
| Divergence point between `main` and `main01` | `751b301` (`origin/main`) |

---

## 5. Git Log Snapshot

```
* b296d6d (HEAD -> main01, origin/main01, backup/main01-before-evidence-security-repair-20260615213049) finalize main01 protection branch
* 030fbb8 (backup/main01-before-full-repair-20260615175420) finalize main01 protection report
* 61db7f8 build main01 protection branch snapshot
| *   3b4f2da (backup/main01-unsafe-branch-name-preserved-202606151735, backup/main01-unsafe-before-security-redaction-20260615172134) Merge local provider normalizer preservation into main01
| |\  
| | * af31603 (codex/local-uncommitted-provider-normalizer-fix) preserve local provider normalizer test fixes
| * | e7f0f5c Merge provider edits debug fixes into main01
| |\| 
| | * e924310 (origin/codex/provider-edits-debug-base64-fix, codex/provider-edits-debug-base64-fix, backup/uncommitted-before-main01-20260615171132) fix provider edits multipart and image normalizer
| * | 3e463de Merge provider stability fixes into main01
| |\| 
| | * ea80cfe (origin/codex/provider-stability-post-merge, codex/provider-stability-post-merge) stabilize provider image routing and browser acceptance
| | * a77c15f (merge-candidate/provider-stability-20260615-main-a77c15f, main) Merge ragflow knowledge-driven template
| |/| 
|/| | 
| * | f0e1d9a Merge ragflow knowledge-driven template into main01
|/| | 
| |/  
| * 4ababd5 (origin/codex/ragflow-knowledge-driven-template, codex/ragflow-knowledge-driven-template) harden ragflow enhancement validation
| * 669859f fix ragflow template evidence chain
| * a81d630 refactor prompt compiler for ragflow knowledge templates
|/  
* 751b301 (origin/main, origin/HEAD) fix final api invalid request body handling
* abfcdb4 fix final v1.4 evidence chain
* 0d7e945 fix final image API v1.4 contract security
* f4b030c Finalize image API contract for downstream testing
* e36b00b fix final image API provider normalization
* d60b4e6 fix final image generation provider flow
* 8b6a8fa feat: add final image prompt optimizer API
* 6873587 (tag: freeze-20260524-image-to-image) freeze: image generator stable build
```

---

## 6. Final Verdict

- **`main01` is clean and fully synchronized with `origin/main01`** (`b296d6d`).
- **Local `main` has 4 unpushed commits** relative to `origin/main`.
- **No evidence** that local `main` has been pushed to `origin/main` or merged into the current `main01` branch.
- **Recommended action:** If the intent is to keep `main` local-only, no action is required. If these 4 commits need to be shared, push `main` explicitly after review; otherwise leave `origin/main` at `751b301`.

**Audit mode:** Read-only. No branches were modified.
