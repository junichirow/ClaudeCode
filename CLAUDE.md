# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

Python の小さな学習・実験用リポジトリ。現時点では `now.py`（現在の日本時間を `YYYY年MM月DD日 HH時MM分SS秒` 形式で表示するスクリプト）のみ。外部依存パッケージはなく、標準ライブラリ（`datetime`, `zoneinfo`）だけを使用している。

## 環境

- Python 3.15（`.venv/` に仮想環境あり。`python3 -m venv .venv` で作成済み）
- 依存管理ファイル（`requirements.txt` / `pyproject.toml`）、テスト、リンター設定はまだ無い

## コマンド

```bash
source .venv/bin/activate   # 仮想環境を有効化
python now.py               # 実行
```

## 規約

- コメント・コミットメッセージ・出力文字列は日本語を使っている
- タイムゾーンは `ZoneInfo("Asia/Tokyo")` で明示する（システムのローカル時刻に依存しない）
