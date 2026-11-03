# MIDI Playground TODO 006：Git clone

2026-11-03。ユーザーが実push成功を確認。既存リポジトリを取り込むcloneの追加依頼を先に記録する。

後続の[todo007.md](todo007.md)で`rm -rf .`と空／JSなしプロジェクトを正式にサポート。以下のルート削除拒否・最低1つのJSという記録はclone初期実装時の状態。

[todo008.md](todo008.md)では`/sys`ガイドの削除にも対応した。cloneはガイドの現在の削除状態を保持し、削除済みのガイドを復活させない。`/sys`へリモートのファイルを書き込むことは引き続き拒否する。

- [x] 単一プロジェクト・ルートのGit構成に合うcloneコマンドと、既存FILESを保持する境界を決める。
- [x] 共有Gitエンジン／ShellへHTTPS cloneを追加。remote既定branchと指定branch、履歴・remote設定・コード／バイナリを扱う。
- [x] cloneをMIDIのGitコントローラー・Native接続へ接続し、失敗・取消・New／Import・同時編集で既存FILESへ部分反映しない。
- [x] 取得内容へ既存の16 MiB／ファイル数・パス・ガイド保護・JSの検証を適用し、演奏停止・エディター・Run file・選択の整合性を保つ。
- [x] 隔離Git pack／Native fixtureで成功と失敗を検証。共有／同梱bundle、英日ガイド、再開TODOを更新する。実remoteへの自動cloneや公開は行わない。

## 仕様と実装

```text
cd /
git clone --replace https://github.com/OWNER/REPOSITORY.git .
```

- 構文は`git clone [--replace] [-b|--branch BRANCH] HTTPS_URL [.]`。1つのFILESプロジェクトをルートのGitリポジトリとして開く。保存先は`/`に解決されるパスだけを許可し、省略すると現在のcwdにかかわらずルートを使う。成功後のShellは`/`へ戻す。
- 既存ファイル・フォルダー・Gitがあれば、`--replace`なしではNative接続前に拒否する。`--replace`は取得と検証がすべて成功してからFILESを置き換える。空にするための先行削除は不要。
- ユーザーが試した`rm -rf ./`は組合せオプションが未対応で拒否、`rm -r ./`はルート保護で拒否する。どちらも既存FILESを保持する。clone用の置換は上記の`--replace`で行う。
- 共有`packages/virtual-files/src/git.js`へcloneを追加。remoteのHEADまたは指定branch、対象branchの全履歴、origin・upstream設定を取得する。checkout前にTREEを検査し、symlink・submodule・`.git`や`/sys`・checkpoint領域への書き込みを拒否する。既存`/sys`ガイドは保持し、旧プロジェクトのcheckpointやファイル種別を混ぜずに置換する。
- MIDIでは取得したUTF-8／BOMをテキストとして扱い、TFI／VGI・Gitデータはバイナリを保つ。既存のサイズ・パス・最低1つのJSを検証してから公開する。失敗・中断・同時編集・プロジェクト交換時には部分反映しない。
- clone成功時は古いFILESメニュー／ダイアログ・コピー状態・Monacoモデル／Undoを破棄。新しいindex.jsまたは最初のJSを選択・Run対象へ設定する。Shellのタブ・履歴は維持し、コードは自動実行しない。
- MIDI／FM2612両Nativeでcloneの読み取り接続を受け付ける。未指定branchはremote HEAD、cloneのcommit指定は拒否。承認済みrepositoryのupload-packだけを扱う。既存の各アプリの認証方式を保ち、MIDI専用／FM専用のトークン保存領域も保つ。
- 標準`npm run build:virtual-files`で共有Web／FM2612 Desktop bundleを再生成し、MIDI同梱bundleとSHA-256記録を同期。英日ガイドとREADME・Helperも更新した。

## 検証

- 共有Virtual Filesパッケージ101件、MIDI JavaScript全210件成功。型定義を含む共有build、各リポジトリの`git diff --check`成功。
- オフラインRustのGit HTTPテストはMIDI11件・FM2612 5件成功し、両側Nativeコードのコンパイルも成功。
- MIDIの通常`cargo build --offline --locked --manifest-path src-tauri/Cargo.toml`も成功。既存のdead_code警告のみ。
- Chromium／WebKitで本番UI・Monaco・演奏Workerを使用し、Native通信だけをインメモリのGit pack fixtureへ置換。非空FILESの事前拒否、既定branch stableからのclone、コード／BOM／binary／履歴／clean状態、Run file／選択、演奏停止と自動実行なしを確認。
- 認証待ち取消・HTTP失敗・Newとの競合で既存FILESを保持。clone前の実Undo・古いモデル・コピー状態、認証待ち中に開いた旧Renameダイアログも成功時に破棄することを確認。両エンジンでページ例外なし。実remote／資格情報は使用していない。
- 記録は`/private/tmp/midi-clone-ui-report.json`、画面は`/private/tmp/midi-clone-{chromium,webkit}-success.png`。実push成功はユーザーが確認済み。実リポジトリのclone／fetch／pullは引き続き利用者による確認対象。
