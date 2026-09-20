# es-module-lexer

`module-lexer.js` is the minimal asm.js distribution of es-module-lexer 3.0.2.
Upstream: https://github.com/guybedford/es-module-lexer
License: MIT, reproduced in `module-lexer.LICENSE`.

Regenerate from the lockfile installation with `node scripts/prepare.mjs`.
This parses module references without treating comments or strings as imports.

# Monaco Editor

Monaco Editor 0.52.2 (MIT) is copied from the locked npm dependency into the ignored `monaco/` directory by `scripts/prepare.mjs`. Both LICENSE and ThirdPartyNotices.txt are bundled there. Upstream: https://github.com/microsoft/monaco-editor

# Acorn

Acorn (MIT) parses inline liveLoop callbacks before lexical helper binding. Version is pinned in package-lock.json; scripts/prepare.mjs copies acorn.mjs and acorn.LICENSE from the installed dependency. Upstream: https://github.com/acornjs/acorn
