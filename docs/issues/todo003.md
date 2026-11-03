# MIDI Playground TODO 003：FILES・Git・演奏補助

2026-11-03。型・定義表示の整備後に取り入れたい機能を整理する。Sync／Revertは概念が分かりにくいため保留とし、今回の導入対象にはしない。

## 合意した対象と順序

1. **FILES整理**：名前変更、削除、フォルダー、移動・コピー、相対パスコピー。既存コード・バイナリ音色・Run file・選択ファイル・エディター状態を整合させる。
2. **Git**：本体と同じく仮想FILESを対象に、履歴・差分・commitを扱えるようにする。Git導入の前提となるファイルシステム・操作UI、`.git`とカセットの関係、ネイティブ接続・認証の境界を先に確認する。実リポジトリやremoteへの操作は機能実装のために勝手には行わない。
3. **stopLoop**：`stopLoop(name)`／`stopAllLoops()`のAPI・ループ所有権・Note Off処理は既に実装済み。今回の差分は、既存のliveLoop名を引数位置で補完することと、使い方を分かりやすくすること。
4. **tween**：`tween({seconds}, callback)`／`tween({beats}, callback)`、グローバル・`pg`・ループ用ヘルパー、型・補完・説明・実行例を整える。BPM変更、外部Clock、Stop／stopLoop／Apply置換、callback例外や非同期callbackの扱いを検証する。
5. **livePrepare**：2026-11-03の追加依頼で導入対象に確定。名前付き初期化の結果・実行中PromiseをApply間で共有し、戻り値を型推論できるようにする。

## 実装状況

- [x] FILES整理のデータ操作とUIを実装し、保存・カセット・import・モジュール・エディターとの整合性を検証する。
- [x] Gitの再利用可能な実装と必要な境界を調査し、実装範囲を具体化して対応する。
- [x] `stopLoop`の既存ループ名補完を追加する。文字列／コメント内の誤検出と無関係なメンバー呼び出しを除外する。
- [x] `tween`の時計・停止・例外・進捗と、型・定義表示・例を実装・検証する。
- [x] 古いHelper説明のchannel番号などを現行APIへ合わせる。
- [x] 英日ガイドとこのTODOを更新し、自動検証結果と未確認事項を残す。

## livePrepareとcontext（調査結果・実装）

`context`はApplyで値を保持する共有オブジェクト。`livePrepare`は名前付きの初期化処理を一度行って結果を再利用するAPIで、責務は完全には同じではない。

- [x] 設計記録・実装履歴を調べ、意図的な代替か未移植かを区別する。
- [x] 追加する場合のRun／Apply／Stop、失敗時の再試行・同時呼び出し・型推論・MIDI初期化の意味を整理する。
- [x] 下記の案を踏まえて、livePrepareを追加することを決定。
- [x] livePrepareの実装、型推論、Run／Apply／失敗・同時呼び出し、例を検証する。

MIDIリポジトリ全履歴の`git log --all -S livePrepare -- ui docs README.md`にも該当がなく、「contextがあるので不要と決めた」という判断の記録は確認できなかった。Example 10／13では`if`や`ready`を使って初期化を手書きしているため、それで用途を満たしつつ補助APIの移植が残っていたとは推測できる。過去の合意としては断定しない。

本体`docs/js/playground_live.js`は名前ごとの成功結果を保持し、失敗は保存しない。MIDIへ追加するなら、Applyで結果を保持、Run／Stopで破棄、同名の初期化中Promiseも共有する小さな準備キャッシュが自然。成功値`undefined`も保存し、catchされた失敗の後は再試行できるようにする。未捕捉エラーがRun全体を停止する現行の挙動は保つ。

戻り値は`livePrepare<T>(name, factory): Promise<T>`で推論させる案。音源の有効化・出力作成・setVoiceを初期化callbackにまとめてMidiOutputを返せば、readyフラグや共有状態への型キャストを減らせる。カウンターや演奏中に変える値は引き続きcontextに置ける。同名callbackを編集してApplyしても初期化し直さないため、変更の反映にはRunまたは名前変更が必要であることを説明する。

## Gitの実装状況と後続工程

- [x] 共有`packages/virtual-files`／配布済みGitエンジンの再利用と、MIDIのFILES・バイナリ値・エディターを接続する。変更の世代を追跡し、編集中やNew／ImportとGit処理が競合しても古いスナップショットを書き戻さない。
- [x] まずローカルのinit／status／diff／add／commit／log／branchを扱う操作UIを作る。Gitエンジンは直接呼び出せるため、Shell全体の導入は必須にしない。
- [x] `/.git`は通常のFILES整理から保護し、バイナリのまま自動保存・カセットへ含める。空フォルダーの保存と、現行16MiB／1024ファイル上限を越える履歴の扱いを決める。
- [x] Gitの変更をエディター・Run file・選択ファイルへ反映し、New Projectでは履歴を含む古いプロジェクトを残さない。
- [ ] fetch／pull／pushは後続でFM2612 Tauriのネイティブ通信・Keychain・認証画面の境界を移す。アプリ固有の資格情報領域を分け、PAT本文をJavaScript・ログ・カセットへ出さない。機能実装のためにユーザーのremoteへ実送信しない。

共有VirtualFSのファイルチェックポイントは既定Offで使える。Git対応のためにSync／Revertの概念やUIを導入する必要はない。共有Gitエンジンにないcheckout／merge／cloneを、初期対応に含むとは案内しない。

## 実装開始時の範囲

FILES整理と共有ファイル管理を先に整え、ローカルGit、演奏補助APIと補完を実装する。Gitのremote通信・OS資格情報は上記の後続工程として扱う。今回、ユーザーの実リポジトリや接続先にpush等は行わない。Sync／Revertは引き続き保留。

## 実装した内容（2026-11-03・未公開）

- FILESは共有VirtualFSを利用。`+`／`Folder+`／`⋯`／右クリック、ドラッグ移動・Ctrl／Optionでコピー、複数Importに対応。空フォルダー・TFI／VGI・Run file・表示ファイルの追従・削除した同梱exampleの再起動後保持を確認。最後の通常JSを失う操作は一時ストアで拒否し、部分反映しない。
- 無変更モデルのUndoは保持。名前変更したモデルはカーソル・表示位置を引き継ぎ、Undo履歴は新規。コード内import／loadVoice文字列の書き換えは行わない。同梱ガイドを含む`/lib`全体の移動・削除は保護し、その中のユーザーファイルは整理できる。
- Menu → Gitはローカルinit／status／diff／stage／commit／log／branch作成。実ホストのGitを操作せず仮想FILESのみを対象とする。`.git`は通常操作・補完・Monaco・演奏Workerから除外し、バイナリのまま保存。New／Importや同時編集に対する世代・revision検査、保存失敗中の未反映編集の保護を実装。
- `.git`履歴・バイナリ音色・空フォルダーを自動保存とCassette v3で往復。旧v1／v2は従来形式を維持。Git更新もファイル本体の16 MiB／1024ファイル・ディレクトリー制約を反映前に検証する。Export時はメタデータ・ZIPの追加分も含めて検証する。旧プロジェクトが新しいパス検証に通らない場合は元データとRecovery JSONを保持し、自動保存を止める。
- `stopLoop("…")`は編集中ファイルのglobal／pgのliveLoop文字列名を補完。コメント・通常文字列・無関係なメンバーを除外し、エスケープ付き名と途中入力に対応。
- `livePrepare<T>`は名前ごとの成功結果と実行中Promiseを共有。Applyで保持、Run／Stopで終了。失敗は保存せず再試行可能。成功値undefinedも保持。ループ停止後に待機側が再開しない。初期化factoryの変更反映はRunか名前変更。
- `tween`は秒／拍、global／pg／ループAPI、直列async callback、内部BPM変更・外部Clock、stopLoop／Apply置換／Stopを検証。音声レートのDSP機能ではなくタイマーによるMIDI制御。
- API型・補完・型定義→実装表示・Helper・英日ガイド・Example 16／17を更新。Helperのチャンネル説明は0〜15とCH1〜CH16へ統一。

## 検証記録

- JavaScript自動テスト168件成功。実際のMonaco言語Workerによる型推論・補完、演奏Worker、fake clock、FILES／Gitの競合・カセット互換性を含む。
- Nativeは`cargo test --manifest-path src-tauri/Cargo.toml`：47件成功、実CoreMIDIサービスを必要とする既存loopbackテスト1件は既定でignored。Nativeのコード変更はない。
- Chromium／WebKitの本番app.js・Monaco・module Workerを使い、Native呼び出しのみ隔離スタブ化してUIを検証。Git init→差分→stage→commit→history→branch→再起動→実カセットExport／Import、戻り値補完、livePrepareのRun／Apply、tweenの進捗・停止を確認。
- Chromiumでは旧データRecovery、`.js`名のGit参照除外、最後のJSの保護、Run対象の再選択も画面から確認。
- 一時検証スクリプト／結果は`/private/tmp/check-midi-{files,git,live,recovery}-ui.cjs`と対応report.json。実際の機器・DAWやユーザープロジェクトは操作していない。

## 残す作業

- Git remote通信・OS資格情報は後続工程。checkout／merge／cloneは共有エンジンにもなく、今回のUIに含めない。
- Nativeアプリでの手動実聴と外部MIDI機器・DAWのタイミング確認。今回のUI自動検証は実音源を再生していない。
- Sync／Revertは保留のまま。今回の機能はまだリリースしていない。

## Code表示の省スペース化とRunショートカット（2026-11-03）

ユーザー追加依頼を実装前に記録し、下記を完了。

- [x] Code上部の表示中パス見出しを取り除く。FILESの選択表示を使い、見出し専用の行を確保しない。
- [x] Keyboard inputを小さい操作部へまとめ、フォーカス・キー入力・blur時の解放は保持する。
- [x] ⌘／Ctrl+EnterをMonacoに届く前に処理し、Runと改行が同時に発生しないようにする。ダイアログ・IME入力・キーリピートも確認する。
- [x] Chromium／WebKitでレイアウト、テキスト無変更とRun呼び出し回数、Keyboard入力を確認する。


実装：Keyboard inputをCodeタブ列の右端に102×28px程度の小さいボタンとして配置し、パス見出し・専用説明行を削除。他のパネルでは非表示にする。Safari系でクリック時にbuttonへフォーカスしない挙動にも対応。Run／Stopのショートカット説明は各ボタンのtitleへ移す。

検証：JavaScript全171件成功。実際のMonacoと演奏Workerを使用したChromium／WebKitで、⌘とCtrlのEnter実行前後にコード本文・モデルversionが不変、Runは1回のみ、キーリピートを抑制、通常Enterは改行、ダイアログ中はRunしないことを確認。Keyboard inputの押下・解放・blur時release、Code以外での非表示、Monaco読込失敗時のtextareaでも改行なしでRunすることを確認。両エンジンでページエラーなし。Nativeの接続は隔離スタブで、実音源やDAWは操作していない。

一時検証：`/private/tmp/check-midi-code-ui.cjs`、結果`/private/tmp/midi-code-ui-report.json`、画面`/private/tmp/midi-code-ui-{chromium,webkit}.png`。


2026-11-03追記：上記で後続としていたShell／HTTPS remote連携は[todo004.md](todo004.md)で実装・検証済み。同梱ガイドは/sysへ移り、/lib全体の移動保護は解除され、READMEも通常のプロジェクトファイルとして扱う。過去の記述はその時点の実装記録。
