#!/usr/bin/env bash
# 秘密鍵ガード hook（PreToolUse）
#
# README/CLAUDE.md の最重要制約を機械的に守る:
#   - API キー（GEMINI/DEEPGRAM 等）は src/main/env.ts 内にのみ閉じ込める
#   - 実体の .env は絶対に commit / 出力しない（.gitignore 済み）
#
# stdin で受け取った PreToolUse ペイロードを判定し、危険な操作は
# exit code 2 でブロックする（stderr の内容が Claude に返り、操作が止まる）。
# .env.example / .env.sample は設定テンプレートなので常に許可する。
#
# 登録: .claude/settings.json の hooks.PreToolUse（Edit|MultiEdit|Write|Read|Bash）

input="$(cat)"

if command -v jq >/dev/null 2>&1; then
  tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
  file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
  command="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
else
  # jq 不在時もガードを諦めない: 入力全体を文字列として両方の検査に回す
  tool_name=""
  file_path="$input"
  command="$input"
fi

block() {
  printf '%s\n' "🚫 秘密鍵ガード: $1" >&2
  printf '%s\n' "   API キー / .env は src/main/env.ts 内に閉じ込める制約です（CLAUDE.md / README.md 参照）。" >&2
  exit 2
}

# 文字列が .env（実体）への参照を含むか。.env.example / .env.sample は安全なので除外。
references_dotenv() {
  local s="$1"
  s="${s//.env.example/__SAFE_ENV__}"
  s="${s//.env.sample/__SAFE_ENV__}"
  printf '%s' "$s" | grep -Eq '(^|[[:space:]=:/"'"'"'])\.env([[:space:]"'"'"']|$|\.|/)'
}

case "$tool_name" in
  Edit|MultiEdit|Write|Read)
    if [ -n "$file_path" ] && references_dotenv "$file_path"; then
      block "$tool_name による .env ファイルへのアクセスは禁止です: $file_path"
    fi
    ;;
esac

# Bash コマンド検査（jq 不在時は tool_name 空でもここを通す）
if [ "$tool_name" = "Bash" ] || [ -z "$tool_name" ]; then
  # .env を git に乗せる（git add / git stage / git commit -a 系）
  if printf '%s' "$command" | grep -Eq '(^|[[:space:]])git([[:space:]]|$)' \
     && printf '%s' "$command" | grep -Eq '(^|[[:space:]])(add|stage)([[:space:]]|$)' \
     && references_dotenv "$command"; then
    block "コマンドが .env を git add しようとしています: $command"
  fi
  # .env の中身を出力する
  if printf '%s' "$command" | grep -Eq '(^|[[:space:];|&])[[:space:]]*(cat|bat|less|more|head|tail|nl|od|xxd|strings)[[:space:]]' && references_dotenv "$command"; then
    block "コマンドが .env の中身を出力しようとしています: $command"
  fi
  # API キー/トークンの環境変数を echo / printf する
  if printf '%s' "$command" | grep -Eq '(echo|printf|print)[[:space:]][^|&;]*\$\{?(GEMINI_API_KEY|DEEPGRAM_API_KEY|[A-Z_]*API_KEY|[A-Z_]*_TOKEN|[A-Z_]*_SECRET)'; then
    block "コマンドが API キー/トークンを出力しようとしています: $command"
  fi
fi

exit 0
