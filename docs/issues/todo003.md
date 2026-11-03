# MIDI Playground TODO 003：FILES・Git・演奏補助

2026-11-03。型・定義表示の整備後に取り入れたい機能を整理する。Sync／Revertは概念が分かりにくいため保留とし、今回の導入対象にはしない。

## 合意した対象と順序

1. **FILES整理**：名前変更、削除、フォルダー、移動・コピー、相対パスコピー。既存コード・バイナリ音色・Run file・選択ファイル・エディター状態を整合させる。
2. **Git**：本体と同じく仮想FILESを対象に、履歴・差分・commitを扱えるようにする。Git導入の前提となるファイルシステム・操作UI、`.git`とカセットの関係、ネイティブ接続・認証の境界を先に確認する。実リポジトリやremoteへの操作は機能実装のために勝手には行わない。
3. **stopLoop**：`stopLoop(name)`／`stopAllLoops()`のAPI・ループ所有権・Note Off処理は既に実装済み。今回の差分は、既存のliveLoop名を引数位置で補完することと、使い方を分かりやすくすること。
4. **tween**：`tween({seconds}, callback)`／`tween({beats}, callback)`、グローバル・`pg`・ループ用ヘルパー、型・補完・説明・実行例を整える。BPM変更、外部Clock、Stop／stopLoop／Apply置換、callback例外や非同期callbackの扱いを検証する。

## 実装前TODO

- [ ] FILES整理のデータ操作とUIを実装し、保存・カセット・import・モジュール・エディターとの整合性を検証する。
- [ ] Gitの再利用可能な実装と必要な境界を調査し、実装範囲を具体化して対応する。
- [ ] `stopLoop`の既存ループ名補完を追加する。文字列／コメント内の誤検出と無関係なメンバー呼び出しを除外する。
- [ ] `tween`の時計・停止・例外・進捗と、型・定義表示・例を実装・検証する。
- [ ] 古いHelper説明のchannel番号などを現行APIへ合わせる。
- [ ] 英日ガイドとこのTODOを更新し、自動検証結果と未確認事項を残す。

## livePrepareとcontext（調査結果・導入案）

`context`はApplyで値を保持する共有オブジェクト。`livePrepare`は名前付きの初期化処理を一度行って結果を再利用するAPIで、責務は完全には同じではない。

- [x] 設計記録・実装履歴を調べ、意図的な代替か未移植かを区別する。
- [x] 追加する場合のRun／Apply／Stop、失敗時の再試行・同時呼び出し・型推論・MIDI初期化の意味を整理する。
- [ ] 下記の案を踏まえて、livePrepareを追加するか決める。現時点では機能の実装は行っていない。

MIDIリポジトリ全履歴の`git log --all -S livePrepare -- ui docs README.md`にも該当がなく、「contextがあるので不要と決めた」という判断の記録は確認できなかった。Example 10／13では`if`や`ready`を使って初期化を手書きしているため、それで用途を満たしつつ補助APIの移植が残っていたとは推測できる。過去の合意としては断定しない。

本体`docs/js/playground_live.js`は名前ごとの成功結果を保持し、失敗は保存しない。MIDIへ追加するなら、Applyで結果を保持、Run／Stopで破棄、同名の初期化中Promiseも共有する小さな準備キャッシュが自然。成功値`undefined`も保存し、catchされた失敗の後は再試行できるようにする。未捕捉エラーがRun全体を停止する現行の挙動は保つ。

戻り値は`livePrepare<T>(name, factory): Promise<T>`で推論させる案。音源の有効化・出力作成・setVoiceを初期化callbackにまとめてMidiOutputを返せば、readyフラグや共有状態への型キャストを減らせる。カウンターや演奏中に変える値は引き続きcontextに置ける。同名callbackを編集してApplyしても初期化し直さないため、変更の反映にはRunまたは名前変更が必要であることを説明する。

## Gitの実装工程案

- [ ] 共有`packages/virtual-files`／配布済みGitエンジンの再利用と、MIDIのFILES・バイナリ値・エディターを接続する。変更の世代を追跡し、編集中やNew／ImportとGit処理が競合しても古いスナップショットを書き戻さない。
- [ ] まずローカルのinit／status／diff／add／commit／log／branchを扱う操作UIを作る。Gitエンジンは直接呼び出せるため、Shell全体の導入は必須にしない。
- [ ] `/.git`は通常のFILES整理から保護し、バイナリのまま自動保存・カセットへ含める。空フォルダーの保存と、現行16MiB／1024ファイル上限を越える履歴の扱いを決める。
- [ ] Gitの変更をエディター・Run file・選択ファイルへ反映し、New Projectでは履歴を含む古いプロジェクトを残さない。
- [ ] fetch／pull／pushは後続でFM2612 Tauriのネイティブ通信・Keychain・認証画面の境界を移す。アプリ固有の資格情報領域を分け、PAT本文をJavaScript・ログ・カセットへ出さない。機能実装のためにユーザーのremoteへ実送信しない。

共有VirtualFSのファイルチェックポイントは既定Offで使える。Git対応のためにSync／Revertの概念やUIを導入する必要はない。共有Gitエンジンにないcheckout／merge／cloneを、初期対応に含むとは案内しない。

この追補は調査・TODO整理まで。FILES、Git、stopLoop補完、tweenの実装・公開は次工程。
