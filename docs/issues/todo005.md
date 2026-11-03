# MIDI Playground TODO 005：Expand固定・FILESメニュー・タブ配置

2026-11-03。追加依頼を実装前に記録する。

- [x] 常にExpand相当の画面構成にして、余白・ヘッダーとExpand／Collapse操作を整理する。Menuは常に上段で利用できるようにする。
- [x] FILESメニューをYM2612版と同じ、ファイル近くのコンテキストメニュー＋Copy／Cut／Paste／Rename／New File／New Folderへ合わせる。既存のトランザクション・バイナリ・保護・最後のJS・中断検査を維持する。
- [x] YM2612版のCode／Console／Shell／Keyboard／Helperと音源パネルの配置を確認して合わせる。ユーザー指定でMIDIとMixerは上段に置く。
- [x] パネル切り替え、キーボード操作、狭いウインドウ、FILES操作とNew／Importを確認する。
- [x] 英日ガイドとこのTODOを更新する。直前のShell／GitHubの未commit変更を保持する。

## 実装

- ウインドウ全体を常に作業領域にし、アプリ内のタイトル見出しとExpand／Collapseを廃止。MenuはRunと同じ最上段へ配置する。
- FILESは左側に常設。上段はCode／YM2612／Sega PSG／MIDI／Mixer、下段はConsole／Shell／Keyboard／Helper。上下の選択は独立し、Panel／×で下段を開閉できる。閉じても下段の選択を保持する。
- FILES幅と下段の高さは境界線のドラッグ・矢印キーで変更し、同じ端末へ保存する。境界線のダブルクリックで初期値へ戻す。小さい画面ではサイズを制限してはみ出しを防ぐ。
- 右クリック／⋯／Shift+F10から非モーダルのFILESメニューを開く。名称入力と削除確認だけダイアログを使う。Renameは名前の変更、移動はCut／Pasteまたはドラッグで行う。
- Copyは操作時点のテキスト・バイナリ・空フォルダーを保持し、Pasteの名前衝突は`-copy`等で回避。CutはPaste成功まで保持し、最新の編集内容を移動する。New／Importでプロジェクトを置換するとコピー状態も破棄する。
- FILESのファイル選択や新規ファイル作成はCodeを表示する。Shell／Gitの背景更新は現在の上段パネルを保つ。読取専用ガイドを選択中のImportはプロジェクト直下へ入れる。

## 検証

- ガイド選択中のImport先とファイル選択ダイアログ中の選択変更も回帰テストへ追加。最終JavaScript全206件成功。`git diff --check`、app.js構文チェックも成功。
- Chromium／WebKitで本番app.js・Monaco・演奏Workerを使用し、Native通信だけを隔離スタブ化して確認。上下タブの独立、MIDI／Mixer上段、FILES常設、下段開閉、縦横リサイズ、メニューと入力ダイアログ、バイナリCopy／Paste、Cut後のRun file追従、New Projectでのコピー状態破棄を確認。
- 800×600／1100×760でウインドウ外への横方向のはみ出しなし。⌘Enterで改行せずRun、Keyboard inputのWorker通知も成功。両エンジンでページ例外なし。
- ガイド選択中のImportは直下、通常ファイル選択中のImportは親フォルダーへ入ることと、Menu → MIDI settingsでメニューが閉じて上段MIDIへ切り替わることも両エンジンで確認。
- 英日ガイドを更新して`node scripts/prepare.mjs`で再生成。検証証跡は`/private/tmp/midi-workbench-ui-report.json`、画面は`/private/tmp/midi-workbench-{chromium,webkit}-{800,1100}.png`。
- ブラウザーでの検証はネイティブ版のUIを隔離実行したもの。今回のUI変更では実音源・DAW・実remote・資格情報を操作していない。

## Shell／Consoleの省スペース化（追加依頼）

- [x] YM2612版のShell／ConsoleとClear操作の有無を確認する。
- [x] MIDI版のClearを下段タブ列の小さいメニューへ移し、出力専用の操作行をなくす。ShellはYM2612版と同様、出力と入力を同じターミナル領域へまとめる。
- [x] Shellの履歴・停止・スクロール・Clear、ConsoleのClear、タブ切替と小さい下段サイズでの表示を確認し、ガイドを更新する。

YM2612版のConsoleには手動Clearがなく、Run時等の内部処理で消去する。Shellにはタブ列の⋯内にClear output、Ctrl+Lの操作がある。今回の変更対象はMIDI版。

MIDI版はConsole／Shell選択時だけ下段タブ列へ⋯を表示し、Clear outputは表示中の出力だけを消す。Shellは独立した操作行、Executeボタン、常設補足文を廃止し、出力・プロンプト・入力を1つのスクロール領域へまとめた。停止は実行中だけタブ列へ表示する。Ctrl+LでShell表示消去、Ctrl+CでShellコマンドだけを中断し、テキスト選択中の通常コピーを維持する。説明は?へ移した。タブ変更・下段を閉じる操作でポップオーバーも閉じる。

関連JavaScript15件、構文チェック、`git diff --check`成功。英日ガイドを更新して再生成した。Chromium／WebKitで本番UIのClear分離・ポップオーバー・履歴・cd後のプロンプト・Ctrl+L・選択中のCtrl+C・偽の保留中Git操作の中断を確認。Clear／中断で音楽のStopを呼ばず、120pxの下段でもスクロールして入力できる。既存UI回帰も成功、ページ例外なし。画面は`/private/tmp/midi-compact-shell-{chromium,webkit}-{800,1100}.png`。
