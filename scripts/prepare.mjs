import {readFile,writeFile} from 'node:fs/promises';
const base=new URL('../',import.meta.url);
const guides={};
for(const name of ['README.md','README_jp.md']) guides['/'+name]=await readFile(new URL('ui/'+name,base),'utf8');
await writeFile(new URL('ui/guide.js',base),`// Generated from README.md / README_jp.md by scripts/prepare.mjs\nexport const guides = ${JSON.stringify(guides)};\nexport function withGuide(files) { return {...files, ...guides}; }\nexport function isGuide(path) { return Object.hasOwn(guides, path); }\nexport function canRun(path) { return /\\.(m?js)$/i.test(path); }\n`);
