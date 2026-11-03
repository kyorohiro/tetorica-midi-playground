# MIDI Playground TODO 008：sysガイドの削除

2026-11-03。ユーザーが`sys`も削除できることを要求。作業前に記録する。

- [x] `rm -r /sys`・`rm -rf sys`、FILESのDeleteで同梱ガイドを削除できるようにする。個別ファイル・サブフォルダーの削除も扱う。
- [x] `rm -rf .`ではsysも含めてFILESを空にする。再読込・保存・カセット往復で削除したガイドを復活させない。
- [x] ガイドが一つもない空のFILESで、エディターの選択解除、保存、ファイル作成、clone、Shell補完を利用できるようにする。
- [x] ガイドの削除状態をプロジェクトへ保存し、失敗・取消・New／Import・同時編集時に状態が混ざらないようにする。新規プロジェクトの初期ガイドは維持する。
- [x] 自動テスト・本番UIのChromium／WebKitで確認し、ガイドと再開記録を更新する。

## 実装

- 同梱ガイドの本文はアプリから取得し、削除した既知のガイドパスだけを`removedGuides`としてプロジェクトへ保存する。古い保存データ内のガイド本文から削除済みガイドを復活させない。`/sys`への編集・新規ファイル作成は引き続き不可。
- Shellの`rm /sys/README.md`、`rm -r /sys/lib`、`rm -rf sys`とFILESのDeleteで、個別・フォルダー単位の削除ができる。ルートでの`rm -rf .`はGit履歴・ガイドを含むFILES全体を空にし、OS保存のトークンは保持する。
- ガイドだけの削除もプロジェクトの変更世代を進める。ファイルと削除状態をまとめて検証し、コマンド失敗・取消や並行操作では部分反映しない。コピー・改名・書込による`/sys`のユーザーファイル化は許可しない。
- 再起動・カセットExport／Importで削除状態を保持する。New Projectは既定のガイドを復元し、clone／pullや通常のファイル編集は現在の削除状態を維持する。
- 英日ガイドとREADMEを更新し、`scripts/prepare.mjs`で同梱ガイドへ反映する。

## 検証

- JavaScript全240件成功。生成後の英日ガイドとguide helperの整合性も確認した。
- Nativeテスト64件成功、機器・OS資格情報を使う3件は既定の除外。通常の`cargo build --manifest-path src-tauri/Cargo.toml --locked`も成功した。
- `/sys`へ移動して現在のフォルダーを削除した場合は、Shellの表示も即座に`/`へ戻ることを確認した。
- Chromium／WebKitの本番app.js・Monaco・Workerで確認し、両方成功、ページ例外なし。FILESでの個別・サブフォルダー削除と取消、全削除後の空のツリー・選択なし・Export file無効、実再読込、削除後のTab補完を確認した。
- 本番UIからカセットをダウンロードし、New Projectでガイド復帰後、そのカセットをImportして削除状態が戻ることを確認した。完全に空のFILESからのJS作成と隔離HTTPS cloneも成功し、clone後もガイドが復活せず、BOM・バイナリ・Git履歴を保持した。実GitHubや保存済みのユーザー資格情報は使わない。
- UI検証記録：`/private/tmp/midi-sys-deletion-ui-report.json`。確認画像：`/private/tmp/midi-sys-deletion-{chromium,webkit}-{empty,new,clone}.png`。
