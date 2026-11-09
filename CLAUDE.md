# buildhybridai-2026（Veil）

Devpost「#BuildHybridAI 2026」（締切 2026-12-01 07:00 JST）に出す Web アプリ。大会の管理は `C:\For Claude\contest-pm\contests\1201-buildhybridai-2026\`（説明文の下書き・動画台本もそこ）。

- 何か: 個人情報を端末内（ルール＋Gemini Nano, ONLY_ON_DEVICE）で検出・マスクし、マスク済みの文だけを Firebase AI Logic の hybrid（PREFER_ON_DEVICE / PREFER_IN_CLOUD）に渡す文書アシスタント。答えの仮名は端末で実名に戻す。
- 構成: Vite + TypeScript（フレームワークなし）。`src/ai.ts`（モデル・端末判定）、`src/router.ts`（タスクと経路）、`src/shield/`（検出・マスク）、`src/main.ts`（UI）。
- 公開: GitHub Pages（`.github/workflows/pages.yml`、main への push で自動）。https://class-now.github.io/buildhybridai-2026/
- Firebase: プロジェクト `buildhybridai-2026-2bd49`（Spark）。AI Logic は App Check を求める（未設定だと 401「Firebase App Check token is invalid」）。App Check を入れたら reCAPTCHA のサイトキーをリポジトリの Variables `VITE_RECAPTCHA_SITE_KEY` に入れて再デプロイ。
- 検証: `npm run build && npx vite preview --port 4173` → `node scripts/e2e.mjs <URL>`（headless。Nano は Prompt API のスタブで確認）。
- 守ること: `~/.claude/CLAUDE.md` の指示の階層に従う。
