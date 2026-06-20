# /start-issue

GitHub issue から実装着手の準備を標準化する。issue 内容を要約し、`main` を最新化した上で**統一命名のブランチを作成**するところまでを行う。実装そのものはユーザー承認後に着手する。

## 使い方

```
/start-issue <issue番号>
```

## 手順

### Step 1: issue を取得して要約

`$ARGUMENTS` を issue 番号として、内容を取得する。

```bash
gh issue view $ARGUMENTS --json number,title,body,labels,assignees
```

取得したら以下を表示する：
- タイトル / ラベル / アサイン
- 「概要」「詳細」「対象ファイル」「懸念事項」の要点
- このプロジェクトのアーキ制約（[`.claude/CLAUDE.md`](../CLAUDE.md)）に照らして、特に注意すべき点（例：API キーは main のみ、scoring は pure TS など）

### Step 2: main を最新化

未コミットの変更がないか確認し、あれば先に退避を促す。クリーンなら：

```bash
git switch main
git pull --ff-only
```

### Step 3: ブランチを作成（命名統一）

ブランチ名は必ず以下の形式に統一する（チームの命名揺れ防止）：

```
feature/issue-<番号>-<slug>
```

- `<slug>` は issue タイトルから生成する英小文字ケバブケース（日本語タイトルは内容を表す短い英語 slug にする。例: 「透明な常時最前面オーバーレイWindowを作成する」→ `overlay-window`）
- slug は 2〜4 語程度、20 文字以内を目安にする

```bash
git switch -c feature/issue-$ARGUMENTS-<slug>
```

作成したブランチ名を表示する。

### Step 4: 着手の足がかりを提示

issue の「対象ファイル」に挙がっているファイルを `Read` で確認し（存在すれば現状、無ければ新規作成対象として）、実装方針の要点を箇条書きで提示する。

**ここで一旦止まり、実装方針をユーザーに確認してから着手する。**

---

## 補足

- 完了後は `/commit_and_push` → `/create-pr` の流れで PR を作成する。
- `/create-pr` はブランチ名 `feature/issue-<番号>-...` から自動で `close #<番号>` を付与する。
- 1 ブランチ = 1 issue を原則とする。
