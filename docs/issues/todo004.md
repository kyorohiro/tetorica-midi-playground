# MIDI Playground TODO 004：ShellとGitHub連携

2026-11-03。ユーザー依頼を実装前に記録する。既存のFILES／ローカルGitへ、本体と同じ仮想ShellとGitHubを含むHTTPS remote操作を追加する。

現行のGit設定画面は[todo005.md](todo005.md)の追加依頼でFM2612版と同じトークン設定だけへ変更済み。Gitの履歴・作者・remote・通信操作はShellの`git`コマンドで行う。以下のGit操作フォームの記録は初期実装時のもの。

cloneの後続対応は[todo006.md](todo006.md)を参照。

## 対象

- [x] 共有VirtualFS Shellを再利用し、FILESを対象とするShellタブ・入力・履歴・出力を用意する。ホストOSのシェルではなく、プロジェクト内のpwd／ls／cd／cat／mkdir／cp／mv／rm／echo等とパイプ・リダイレクトを扱う。
- [x] Shell変更をエディター・Run file・選択・自動保存へ反映する。ガイド／.gitの保護、最後のJS、サイズ制約、New／Import・同時編集・中断時の古い書き戻しを検証する。
- [x] Shellのgitコマンドと既存Git UIを同じコントローラーへ接続する。
- [x] GitHub等のHTTPS remote URL・branch設定、fetch／pull（fast-forward）／pushを追加する。実際の利用者のremoteへの送信は自動検証で行わない。
- [x] FM2612 TauriのHTTPS通信・native PAT登録／削除／選択・OS資格情報保存を移す。MIDI専用の保存領域とservice名を使い、秘密をJS・ログ・カセットへ渡さない。
- [x] 通信先・branch・commitをnative側で限定し、pushは実装済みの具体的な送信内容をnative画面で確認する。remoteの共有処理へTauri固有コードを混ぜない。
- [x] JavaScript／Rustの自動テストと、Native通信のみスタブ化した実画面検証を行う。ネットワークは隔離fixture／偽transportで検証する。
- [x] 英日ガイド・TODO索引を更新し、実装・未対応・手動確認の境界を記録する。

## 方針

- 既存 `packages/virtual-files` のShell／Gitエンジンと、`w/tetorica-fm2612-playground-tauri`のnative境界を再利用する。
- GitHub専用Webログインを新しく発明せず、本体と同じnative PATとKeychain方式を優先する。公開remoteの匿名読み取りも、既存transportの能力を確認して扱う。
- checkout／merge／cloneは共有Gitエンジンの実装能力を越えて案内しない。Sync／Revertは引き続き保留。
- リリース・version変更・利用者の実remoteへのpushは、今回の機能実装や検証のためには行わない。


## 実装済み（2026-11-03・未公開）

- `ui/project-shell.js`：Shellタブ、入力・履歴・中断、共有Shellエンジンによるナビゲーション／検索／編集／パイプ／リダイレクト。仮想FILESだけを扱い、読み取りでは演奏を継続、変更時に停止する。一時ストアを検証後に一括反映し、Run file・選択・モデル表示位置も移動に追従する。
- ShellのGitは`ui/project-git.js`の同じコントローラーを使う。UI／Shellでremote・設定・commit・履歴を共有する。Gitとパイプ／リダイレクトの混在は拒否し、通常Shellから.gitを読み書きしない。
- Git画面へremote URL／branch、fetch／現在ブランチのfast-forward pull／push、NativeのPATメタデータ登録・選択・削除を追加。`ui/native-git.js`でエラー形式・バイト列・中断を接続し、Native許可後にだけHTTPSを扱う。
- RustへHTTPS transport、Native入力・token選択、OS資格情報保存を移植。MIDI専用service `io.tetorica.midi-playground.git-tokens`とapp-data領域を使用。URL・HTTP endpoint・service・push対象branch／commitを検証する。公開remoteでhostにtokenがなければ、Native確認後に匿名読み取り可能。
- プロジェクト交換、編集中断、認証待ち、HTTP途中、window終了、token変更・削除で古いセッションやFILESを復活させない。秘密をJavaScript・ログ・カセットへ渡さず、request body／responseにも64 MiB上限を設ける。
- GitHubの一般的なREADMEを保存できるよう、同梱ガイドを`/sys/...`へ移動。通常の`README.md`／`lib/README.md`は編集・Git管理可能。旧プロジェクトのガイド選択は、同名の実ファイルがない場合のみ移行する。カセット・ローカル保存からsystemガイドを除外し、remoteからの/sys上書きも拒否する。
- pullしたUTF-8のコード・READMEを文字列として扱い、TFI／VGI・Gitデータはバイナリ保持。MonacoでもBOMを落とさず、ファイル表示や保存前同期だけでGitをdirtyにしない。
- 対応するユーザー手順は英日ガイドとHelperへ記載。最初は空のGitHub repositoryへlocal commitをpushし、その後fetch／pullする。既存履歴はGit入りCassetteから再開できる。
- 共有ShellのlicenseとNative依存noticesを配布UI領域へ配置。新たにlockへ入った133 crate/versionを照合し、親のnoticeにない24件の実licenseを追記した。

## 検証結果

- `CARGO_NET_OFFLINE=true npm test`成功：JavaScript **193件**、Rust **61件**成功。実CoreMIDI／OS資格情報の既存連携テスト3件は既定ignored。実際のネットワーク・PAT・Keychainは使っていない。
- `cargo build --offline --locked --manifest-path src-tauri/Cargo.toml`の通常macOSビルド成功。テスト専用でないsetup・IPC登録・Native UI経路もコンパイルできる。
- Git smart-HTTPSをインメモリのcommit／pack fixtureで検証。fetch、fast-forward pull、pushの実バイト列、未commit／分岐拒否、編集／中断／Newとの競合、検証失敗時のrefs・ファイルの未反映を確認。
- Chromium／WebKitで実app.js・Monaco・Shellを使い、Nativeだけ偽IPCにして画面検証。Shellの読み取り中の演奏継続、変更時停止、バイナリ移動、2段階folder移動、Run対象追従、保護、pipeline失敗、履歴、UIとのGit共有、New時の中断・cwd／履歴リセットを確認。
- 両エンジンでremote URL保存、Native tokenメタデータ操作、BOM付きコードのclean状態、認証待ち中のNewと遅延許可の破棄を確認。ページエラー0件。実remote・実資格情報へのアクセス0件。
- 一時検証script／report：`/private/tmp/check-midi-shell-ui.cjs`／`midi-shell-ui-report.json`、`/private/tmp/check-midi-github-ui.cjs`／`midi-github-ui-report.json`。スクリーンショットも同じ一時領域へ保存し目視確認済み。

## 残る手動確認・範囲外

- 2026-11-03：ユーザーから実際のpush成功を確認。別環境commit後のfetch／pull、資格情報ストア自体の確認は別途行う。
- macOS以外のNativeビルド・実際の資格情報ストアは未確認。親のplatformコードを保持したことは、Windows／Linux検証済みを意味しない。
- clone／checkout／mergeは共有Gitエンジンに未搭載。無関係な既存GitHub repoを初期プロジェクトへ読み込む手順は提供しない。
- ShellはOSシェル・任意JavaScript実行ではなくFILES用。`js`／`play`／`result`、Shell固有snapshot／undo、コマンド連結・展開は未公開。`help`に対応範囲を表示する。
- Sync／Revertは保留のまま。今回の機能のversion変更・release・実remoteへのpushは行っていない。
