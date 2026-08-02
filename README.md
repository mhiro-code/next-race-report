# next-race-report

netkeiba「次走想定（古馬）」の一覧を、検索・レース名フィルター・並び替えに対応させたブラウザ版レポートです。

収得賞金は JRA-VAN Data Lab / JV-Link の UM レコードから取得した CSV を取り込み、競走馬コード（血統登録番号）で照合します。

## 主な機能

- 馬名・レース名の検索
- 予定レース、NEW 表示による絞り込み
- 馬名、レース名、収得賞金順の並び替え
- netkeiba の馬・レース詳細ページへのリンク
- netkeiba 掲載データの再取得
- Data Lab の収得賞金データ取り込み

## 開発環境

- Node.js 22.13 以上
- npm

```bash
npm ci
npm run dev
```

本番相当の確認:

```bash
npm test
```

## Data Lab データの更新

### 1. JV-LinkからCSVを出力

JRA-VAN Data LabとJV-Linkを利用できるWindows PCで、リポジトリ直下から次を実行します。64-bit環境から起動した場合も、スクリプトが32-bit Windows PowerShellへ自動的に切り替えます。

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& ".\tools\windows\jvlink-all-horse-prizes.ps1"
```

処理が完了すると、`tools/windows/all-horse-prize-money.csv` が生成されます。

### 2. サイト用JSONへ変換

生成したCSVを次のコマンドでサイト用データへ変換します。

```bash
python3 scripts/import-data-lab-prizes.py tools/windows/all-horse-prize-money.csv
```

生成結果は `app/data-lab-prize-money.json` に反映されます。CSVには全取得馬のデータが含まれますが、JSONへ保存するのは現在の次走一覧に掲載されている馬だけです。

CSV自体は個人の取得データとしてGitHubへ登録しません。更新時にコミットするのは、原則として生成された `app/data-lab-prize-money.json` です。

## 管理方針

- `main` を公開可能な安定版として扱います。
- 変更は作業ブランチと Pull Request で確認してから `main` へ取り込みます。
- 現在の ChatGPT Sites 版は、新しい公開先が動作確認できるまで退避用として残します。
- 次の公開先は Cloudflare を予定しています。

## データについて

掲載内容は各提供元の更新状況に依存します。出走予定や収得賞金は参考情報として扱い、正式な出走情報は主催者の発表で確認してください。
