# next-race-report

netkeiba「次走想定（古馬）」と「次走想定（2歳・3歳）」の一覧を統合し、検索・レース名フィルター・並び替えに対応させたブラウザ版レポートです。

重賞の出走順位目安は、Windows PCに保存済みのTARGET Frontier JVデータ（`D:\TFJV`）からローカル計算します。順位更新ではJRA-VANからの追加ダウンロード、JV-Link、COM接続を使用しません。

## 主な機能

- 馬名・レース名の検索
- 予定レース、NEW 表示による絞り込み
- 馬名、レース名、収得賞金順の並び替え
- netkeiba の馬・レース詳細ページへのリンク
- GitHub Actionsによるnetkeiba掲載データの再取得
- Data Lab の収得賞金データ取り込み
- TARGETローカルデータによる重賞出走順位目安の計算・確認・保存

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

## 次走予定データの更新

GitHubで **Actions** → **Update next-race data** → **Run workflow** の順に開き、もう一度 **Run workflow** を押します。

処理が成功すると、古馬と2・3歳の両ページから取得した内容が `app/next-races.json` へ自動コミットされ、GitHub Pagesにも反映されます。画面の再読み込みは、反映後のJSONを表示するだけです。

## TARGETローカルデータから順位目安を更新

Windows PCの `D:\TFJV` にTARGETの保存済みデータがある状態で、リポジトリ直下からローカル管理画面を起動します。

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& ".\tools\windows\start-target-local-admin.ps1"
```

`http://127.0.0.1:3210/` を開き、TARGET登録前のレースは開催日を指定して **JRA公式番組を取得** を押します。JRA公式番組は明示操作時だけ1ページ取得し、24時間ローカルキャッシュを使います。表示された候補から **管理者確認候補を追加** で地方馬などを追加できます。情報源メモは `.target-local/` に保存され、公開JSONには含めません。

候補にJRA・NAR・JBISの公式情報URLを登録した場合は、**賞金・成績を再取得** を明示的に押したときだけ、登録URLを1件ずつ確認します。明示された「収得賞金」欄だけを使い、JBISの総賞金や本賞金を収得賞金へ置き換えません。アクセス制限（403・429・503）が返った場合はその時点で停止します。

TARGET登録後は対象レースを選択して **TARGETローカルデータから更新** を押します。TARGET登録前の候補と管理者確認候補は一覧から自動削除せず、結果を確認してから **保存して公開データへ反映** を押すと、開催日・レース単位の `app/race-rankings/` JSONだけが更新されます。GitHubへのpush、Pull Request、マージは自動実行しません。

GitHub Pagesは保存済みの `app/race-rankings/index.json` を閲覧し、未保存のTARGETデータを直接読み取りません。週次のnetkeiba再取得はこの順位JSONを削除しません。

## Data Lab データの更新

以下は既存の一般収得賞金CSV取り込み手順です。TARGETローカルの重賞順位更新では使用しません。

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
- 公開先はGitHub Pages（`https://mhiro-code.github.io/next-race-report/`）です。
- 現在のChatGPT Sites版は退避用として残します。

## データについて

掲載内容は各提供元の更新状況に依存します。出走予定や収得賞金は参考情報として扱い、正式な出走情報は主催者の発表で確認してください。
