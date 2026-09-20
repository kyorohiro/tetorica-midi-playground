import {init,parse} from './vendor/module-lexer.js';

function resolvePath(specifier,from){
  if(!specifier.startsWith('./')&&!specifier.startsWith('../'))throw new Error('Only relative FILES imports are supported: '+specifier);
  const parts=from.split('/').slice(0,-1);
  for(const part of specifier.split('/')){
    if(part==='.'||!part)continue;
    if(part==='..'){if(parts.length<=1)throw new Error('Import escapes FILES root');parts.pop();}
    else parts.push(part);
  }
  return parts.join('/');
}

export async function prepareModules(files,source,path,createUrl=code=>URL.createObjectURL(new Blob([code],{type:'text/javascript'}))){
  await init();
  const cache=new Map(),visiting=new Set(),urls=[];
  function moduleUrl(path){
    if(visiting.has(path))throw new Error('Circular FILES import: '+path);
    if(cache.has(path))return cache.get(path);
    if(!Object.hasOwn(files,path)||typeof files[path]!=='string'||! /\.(m?js)$/i.test(path))throw new Error('JavaScript file not found: '+path);
    if(visiting.size>=64)throw new Error('FILES import nesting exceeds 64');
    visiting.add(path);
    const code=rewrite(files[path],path,false);
    visiting.delete(path);
    const url=createUrl(code);urls.push(url);cache.set(path,url);return url;
  }
  function rewrite(code,path,entry){
    const [imports,exports]=parse(code);
    if(entry&&exports.length)throw new Error('Run file cannot export; put exports in an imported module.');
    const edits=[];
    for(const item of imports){
      if(item.d===-2)throw new Error('import.meta is not supported in FILES modules');
      if(entry&&item.d===-1)throw new Error('Use await import("./file.js") in Run file');
      if(typeof item.n!=='string'||item.a!==-1)throw new Error('Use a literal relative import without attributes');
      const url=moduleUrl(resolvePath(item.n,path));
      edits.push({start:item.s,end:item.e,text:item.d===-1?url:JSON.stringify(url)});
    }
    for(const edit of edits.sort((a,b)=>b.start-a.start))code=code.slice(0,edit.start)+edit.text+code.slice(edit.end);
    return code;
  }
  try{return {code:rewrite(source,path,true),dispose:()=>urls.forEach(url=>URL.revokeObjectURL(url))};}
  catch(e){urls.forEach(url=>URL.revokeObjectURL(url));throw e;}
}
