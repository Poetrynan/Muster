# Muster

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/EN-English-blue?style=flat-square" alt="English"></a>
  <a href="README.zh-CN.md"><img src="https://img.shields.io/badge/中文-简体中文-red?style=flat-square" alt="简体中文"></a>
  <a href="README.ja.md"><img src="https://img.shields.io/badge/日本語-日本語-9cf?style=flat-square" alt="日本語"></a>
  <a href="README.ko.md"><img src="https://img.shields.io/badge/한국어-한국어-ff69b4?style=flat-square" alt="한국어"></a>
</p>

<p align="center">
  <img src="assets/banner.svg" alt="For The Better Monash · works with Moodle" width="480">
</p>

> **For The Better Monash · works with Moodle™** — 自分の Moodle の学習をひとつにまとめるデスクトップアプリ。

<p align="center">
  <a href="https://github.com/Poetrynan/Muster/stargazers"><img src="https://img.shields.io/github/stars/Poetrynan/Muster?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Stars"></a>
  <a href="https://github.com/Poetrynan/Muster"><img src="https://img.shields.io/badge/GitHub-Repository-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Repository"></a>
  <a href="https://github.com/Poetrynan/Muster/releases"><img src="https://img.shields.io/badge/version-0.1.1-38bdf8?style=for-the-badge" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-38bdf8?style=for-the-badge" alt="License: PolyForm Noncommercial 1.0.0"></a>
</p>

> **For The Better Monash（より良い Monash のために）** — Muster は、Monash の学生が日常の Moodle 学習をより効率的で手軽にするというシンプルな目的で作った、独立した無料プロジェクトです。コース・課題・締切・お知らせ・資料をすべてひとつの場所にまとめ、探す時間を減らし、学ぶ時間を増やす。学生がより良く学べるようになることが、Monash をより良くすることにつながると信じています。
>
> Muster は Monash University や Moodle の公式製品ではありません。Monash University および Moodle Pty Ltd とは提携しておらず、関係はありません。「Monash」「Moodle」は各権利者の商標であり、本ソフトウェアの対応対象を示す目的でのみ使用しています。
>
> Muster はユーザーのデバイス上でローカルに動作し、Moodle の認証情報やコースデータを収集・送信することはありません。認証済みユーザーが既にアクセス権限を持つリソースにのみアクセスします。
>
> ソースコードは **PolyForm Noncommercial License 1.0.0** の下で公開されています。個人・非商用の利用は完全に無料です。
>
> Muster は個人・非商用の学習用途でのみ提供されます。ライセンスまたは利用規約に違反した場合（本ソフトウェアの有償販売や所属機関の方針違反を含みますがこれらに限りません）、生じたいかなる法的責任も利用者自身が負うものとし、原作者は一切の責任を負いません。

Muster は学生向けのデスクトップアプリです。Moodle に散らばったコース・課題・締切・小テスト・お知らせ・資料をひとつのダッシュボードに集約し、締切を逃しません。

## ✨ 主な特長

### 📅 統一締切カレンダー
全コースの課題・小テスト・試験の締切を一本のタイムラインに統合し、**今日 / 今後7日 / 今月** にグループ化。コースページを一つずつ確認する必要はありません。
> 例：一目で「Quiz 1 は3日後、AT3 は2週間後」と分かります。

<p align="center"><img src="assets/preview/dashboard.svg" alt="Muster ダッシュボード：全コースの締切を緊急度順に統合表示" width="840"></p>

### 🔔 スマート通知
締切前のシステム通知に加え、新資料・新お知らせ・成績公開も通知。リマインド時期（1/3/7日前）は自由に設定できます。
> 例：他の作業中に「Applied Task AT3 — 3日後に締切」と通知が届きます。

### 📄 課題トラッキング
締切順に並んだ課題リストに Moodle の**実際の提出状況**（提出済み/採点済み/未対応）を表示。過去学期の課題は自動アーカイブされ、邪魔になりません。
> 例：進捗バーは提出状況が追跡できる課題だけを数えるので、正直な数字です。

<p align="center"><img src="assets/preview/assignments.svg" alt="Muster 課題リスト：Moodle の実際の提出状況を表示" width="840"></p>

### 🗂️ お知らせの自動分類
お知らせを自動判別（課題/小テスト/試験/資料/成績）し、コースごとに整理、未読優先、ワンタップのタイプフィルター。
> 例：「試験」フィルターだけで全コースの試験関連のお知らせを一覧表示。

<p align="center"><img src="assets/preview/announcements.svg" alt="Muster 通知センター：お知らせを自動分類しコース別に整理" width="840"></p>

### 📥 ダウンロードマネージャー
コース資料（PDF/スライド/フォルダ）をローカルへ一括ダウンロード。進捗・速度をリアルタイム表示、完了後はフォルダを自動オープン。
> 例：長距離フライト前に、今週の講義資料をワンクリックでダウンロード。

<p align="center"><img src="assets/preview/downloads.svg" alt="Muster ダウンロードマネージャー：進捗と速度をリアルタイム表示" width="640"></p>

### 🤖 AI コース要約
週間の資料・課題・お知らせをワンクリック要約。**ストリーミング出力**（文字がリアルタイム表示）+ 完全な Markdown レンダリング。要約言語は UI 言語に連動。
> 例：コースを開いて「生成」をタップすると、概要 → 資料 → 課題・小テスト → 次のステップの構造化サマリーが得られます。

<p align="center"><img src="assets/preview/ai-summary.svg" alt="Muster AI コース要約：ストリーミング出力と完全な Markdown レンダリング" width="760"></p>

### 🔒 プライバシー最優先
すべてのデータはローカル保存。認証は Monash Okta SSO を直接使用し、平文パスワードは保存されません。セッション Cookie は OS の資格情報ストアで保護。
> 例：アプリをアンインストールしても、あなたのデータはサーバーに残りません。


## 🚀 はじめ方
 
> **対応プラットフォーム**：Muster は **Windows 10 / 11 (64-bit)** および **macOS 12+ (Apple Silicon & Intel)** に対応しています。

1. [Releases](https://github.com/Poetrynan/Muster/releases) ページから対応するインストーラーをダウンロードします：
   - **Windows**：`Muster_0.1.1_x64-setup.exe`（または `.msi`）
   - **macOS (Apple Silicon M1/M2/M3/M4)**：`Muster_0.1.1_aarch64.dmg`
   - **macOS (Intel)**：`Muster_0.1.1_x64.dmg`
2. アプリを起動し、Monash アカウントでログインします（Okta SSO）。
3. **Moodleと同期** をクリックすると、コース、課題、資料、お知らせが自動で取得されます。

> ソースからビルドする場合: `npm install && npm run build && npx tauri build` を実行（Rust ツールチェーンが必要）。

## 🔐 データとプライバシー

- 認証はすべて Monash Okta SSO 経由。アプリは平文のパスワードを保存しません。
- セッション Cookie は OS の資格情報ストアに保存され、外部へ送信されません。
- 教材の著作権は各権利者に帰属します。本ツールはローカルでの閲覧・整理のみを提供します。
- 同期は意図的に低頻度で、リクエストにも間隔と同時実行数の上限を設けています。そのため常に通常の人間の利用範囲に収まり、所属機関のサーバーに負荷をかけることはありません。

## ⚠️ 免責事項

Muster は独立した個人用ツールであり、Monash University や Moodle の公式製品ではありません。両者とは提携していません。自分のアカウントが既に権限を持つコースのみにアクセスします。所属機関の利用規程および教材の著作権の遵守は利用者ご自身の責任です。詳細は [TERMS.md](TERMS.md) をご覧ください。

## 💬 フィードバック

[Issues](https://github.com/Poetrynan/Muster/issues) でお気軽にご報告ください。

## 📄 ライセンス

本プロジェクトは [PolyForm Noncommercial License 1.0.0](LICENSE) の下で提供されます。個人学習を含む非商用目的であれば無料でご利用いただけますが、商用利用は認められていません。

© 2026 Poetrynan · 商標について: [NOTICE](NOTICE) · エンドユーザー向け条項: [TERMS.md](TERMS.md) · 第三者ライセンス表示: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
