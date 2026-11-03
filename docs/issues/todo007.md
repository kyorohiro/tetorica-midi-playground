# MIDI Playground TODO 007：Shell削除・補完・行編集

2026-11-03。ユーザーが`rm -rf .`とFM2612版と同じ補完・Ctrl+A／Ctrl+Eを明示的に要求。作業前に記録する。

下記はこの段階の実装・検証記録。後続の[todo008.md](todo008.md)でガイド削除にも対応し、現在の`rm -rf .`は`/sys`も含めてFILESを空にする。保存済みトークンは引き続き保持する。

- [x] 仮想FILESの`rm -rf .`で現在のプロジェクトを空にできるようにする。ルート指定ではGit履歴も含めて削除し、同梱`/sys`ガイドとOS保存のトークンは保持する。ホストのファイルは扱わない。
- [x] `-r`／`-R`／`-f`／組合せ・長いオプション・`--`を共有rmへ追加し、通常フォルダー・forceでの未存在ファイルを扱う。
- [x] 空／JSなしのプロジェクトを保存・カセット往復・再起動できるようにし、Runなし状態・エディター・FILES・Git・cloneへ接続する。最後のJSを残す旧制約を見直す。
- [x] ShellのTabパス補完とCtrl+A／Ctrl+E等の行編集をFM2612版へ合わせる。引用符・空白・相対パス・候補一覧・履歴・IME・通常コピーを確認する。
- [x] 自動テストと本番UIのChromium／WebKitで、削除→空保存→再起動→clone、補完・キー操作を検証し、ガイドと再開記録を更新する。

## 実装

- 共有Shellへ`parseRmArgs`と再帰／forceのオプションを追加。MIDIではルートに対する再帰forceを、仮想プロジェクト全消去として扱う。通常の`rm`や`rm -r /`のルート保護、個別のガイド／隠しGitへの保護は維持する。サブフォルダーの削除はその範囲だけに適用する。
- 削除は私有draftへ行い、pipeline失敗・中断・プロジェクト交換時は部分反映しない。ルート全消去の成功時にGit操作の世代、旧FILESメニュー／コピー、エディターモデル／Undoを無効化し、演奏を停止する。Shell自体の履歴と入力は引き続き利用できる。
- 最後のJSを削除・改名できる。JSがなければRun fileは空値と`No JavaScript files`表示にし、Run／Apply／script用Keyboard inputを無効化する。新しいJSの作成・取り込みで復帰する。JSなしのclone／pullも既存のパス・サイズ検証を満たせば保存できる。
- カセットは`runPath:''`の空／JSなし状態を保存・復元できる。真に空のExportはv3にし、v1〜v3の読込互換を保つ。再起動してもスターターファイルを復活させない。
- 新規`ui/shell-input.js`でTabパス補完とCtrl+A／E／B／F／U／K／Wを追加。引用符・空白・Unicode・共通prefix・候補一覧・リダイレクト先を扱う。補完は現在のFILESを参照する読み取り操作で、演奏を停止しない。IME・Cmd系・選択中の通常コピー・Ctrl+C／L・履歴矢印は維持する。
- 共有モジュール／型定義を再生成してMIDI同梱Shellへ同期。英日ガイド、Helperの操作説明とREADMEを更新・再生成した。

## 検証

- 共有Virtual Files全106件、MIDI JavaScript全226件成功。共有build／型定義生成・差分検査成功。
- MIDIの通常Nativeビルドも成功（既存のdead_code警告のみ）。
- Chromium／WebKitで本番app.js・Monaco・演奏Workerを使用し、Nativeのポート／トークン／HTTPSだけを隔離fixtureへ置換。補完中の演奏継続、Ctrl+A／Eと関連行編集、Unicode、Cmd／IME、相対／引用／空白／ディレクトリー／候補一覧／リダイレクトのTab補完を確認。
- `rm -rf .`でGitを含む全消去、ガイド／トークン保持、旧モデル／コピー状態破棄、Runなし表示、再読込しても空状態の保持、カセット往復、新規JSでRun復帰、サブフォルダー単位の削除を確認。
- ルート全消去後の`git clone HTTPS_URL .`が`--replace`なしで成功し、履歴・BOM・バイナリを保持することを確認。実remote・実資格情報へのアクセスなし、両エンジンでページ例外なし。
- 記録は`/private/tmp/midi-shell-editing-ui-report.json`、画面は`/private/tmp/midi-shell-editing-{chromium,webkit}-{empty,clone}.png`。
