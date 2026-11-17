---
tags:
  - git
  - workflow
  - ci
  - anime-guesser
---

# Git Workflow & Commit Standards

← Back to [[INDEX]] | State: [[STATE]]

## 1. Branching Strategy

Anime Guesser follows a strict 3-tier branching model:

- **`main` (Production):**
  - Holds only stable, tested, production-ready releases.
  - **Direct pushes to `main` are strictly forbidden** after initial repository bootstrap.
  - Updated exclusively via fast-forward or explicit release merges from `dev` when instructed by the project maintainer.
- **`dev` (Integration):**
  - Default active branch for ongoing development integration.
  - All feature and fix branches are created from and merged back into `dev` using `--no-ff`.
- **`feat/<short-name>` & `fix/<short-name>` (Task Branches):**
  - Created off `dev` for every discrete feature, refactor, or bugfix (e.g., `feat/trgm-search`, `feat/clue-ui`, `fix/streak-reset`).

## 2. Standard Task Lifecycle

```bash
# 1. Start from an up-to-date dev branch
git checkout dev
git pull origin dev

# 2. Create a dedicated task branch
git checkout -b feat/<short-name>

# 3. Verify compilation before committing
cd backend && npx tsc --noEmit && npm run build
cd ../frontend && npx tsc --noEmit && npm run build

# 4. Update docs/STATE.md, stage, commit, and push branch
git add .
git commit -m "feat(scope): concise description in English"
git push -u origin feat/<short-name>

# 5. Merge into dev with --no-ff and push dev
git checkout dev
git merge --no-ff feat/<short-name> -m "chore(merge): merge feat/<short-name> into dev"
git push origin dev
```

## 3. Conventional Commits Specification

Every commit message must be written in **English** and adhere to the format:

```
<type>(<optional-scope>): <short imperative summary>
```

### Allowed Types
- `feat`: New feature or gameplay capability (`feat(backend): add pg_trgm anime search endpoint`)
- `fix`: Bug fix (`fix(game): prevent answer leak on in-progress session response`)
- `docs`: Documentation updates in `docs/` or `README.md` (`docs: update STATE.md after search milestone`)
- `refactor`: Code restructuring without behavior changes (`refactor(users): extract streak helper`)
- `chore`: Build scripts, dependencies, CI, or tooling (`chore(ci): configure github actions workflow`)
- `test`: Adding or updating unit/e2e tests (`test(game): add session state transition specs`)

## 4. Continuous Integration (`.github/workflows/ci.yml`)

GitHub Actions automatically runs on every push to `main`, `dev`, and `feat/**`:
1. **Backend Job:** `npm ci` → `npx prisma generate` → `npx tsc --noEmit` → `npm run build`
2. **Frontend Job:** `npm ci` → `npx tsc --noEmit` → `npm run build`
