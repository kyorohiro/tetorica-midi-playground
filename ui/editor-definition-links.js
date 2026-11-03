import {apiTypes} from './api-types.js';
import {declarationTarget} from './editor-definitions.js';

const namespace='/tetorica-definition/';
const apiUri='file:///tetorica-api.d.ts';
const typeNames=new Set([...apiTypes.matchAll(/^(?:interface|type)\s+([A-Za-z_$][\w$]*)/gm)].map(match=>match[1]));
const known=symbol=>typeof symbol==='string'&&/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(symbol)&&!!declarationTarget(symbol);
const escapeMarkdown=text=>text.replace(/[\\`*_{}\[\]()<>#!|]/g,'\\$&');
const link=symbol=>`[${symbol}](file://${namespace}${symbol})`;

// Use the public link opener so native TypeScript completion JSDoc can contain
// the same links. No command links or trusted user-supplied Markdown are needed.
export function registerDefinitionLinks(monaco,viewer) {
  let disposed=false;
  const opener=monaco.editor.registerLinkOpener({
    open(resource) {
      if(resource.scheme!=='file'||!resource.path.startsWith(namespace))return false;
      // Consume every URL in our namespace, including malformed targets, so none
      // can fall through to an external application or filesystem handler.
      if(!disposed&&!resource.authority&&!resource.query&&!resource.fragment) {
        const symbol=resource.path.slice(namespace.length);
        if(known(symbol))viewer.openSymbol(symbol);
      }
      return true;
    },
  });

  function documentation(text,symbol) {
    const linked=new Set();
    const value=String(text??'').split(/\b([A-Za-z_$][\w$]*)\b/).map(part=>{
      if(typeNames.has(part)&&known(part)){linked.add(part);return link(part);}
      return escapeMarkdown(part);
    }).join('');
    const target=known(symbol)&&!linked.has(symbol)?`\n\nView definition: ${link(symbol)}`:'';
    return {value:value+target,isTrusted:false,supportHtml:false};
  }

  const hover=monaco.languages.registerHoverProvider(['javascript','typescript'],{
    async provideHover(model,position,token) {
      if(disposed||token?.isCancellationRequested||model.uri.scheme!=='file')return null;
      const version=model.getVersionId();
      const stale=()=>disposed||token?.isCancellationRequested||model.isDisposed()||model.getVersionId()!==version;
      try {
        const typescript=monaco.languages.typescript;
        const getWorker=await (model.getLanguageId()==='typescript'?typescript.getTypeScriptWorker():typescript.getJavaScriptWorker());
        if(stale())return null;
        const worker=await getWorker(model.uri);
        const offset=model.getOffsetAt(position),uri=model.uri.toString();
        const [info,definitions]=await Promise.all([
          worker.getQuickInfoAtPosition(uri,offset),worker.getDefinitionAtPosition(uri,offset),
        ]);
        if(stale()||!info?.textSpan)return null;
        const apiDefinitions=(definitions??[]).filter(item=>item.fileName===apiUri);
        const symbols=new Set();
        for(const item of apiDefinitions) {
          const qualified=item.containerName?`${item.containerName}.${item.name}`:item.name;
          if(known(qualified))symbols.add(qualified);
        }
        for(const part of info.displayParts??[]) {
          // JSDoc typedefs and JS classes that shadow API type names are reported
          // as aliasName/className, rather than the API's interfaceName. For
          // other related types, require an actual API declaration as the source.
          if(typeNames.has(part.text)&&(apiDefinitions.length||part.kind==='interfaceName'&&model.getLanguageId()==='javascript')&&known(part.text))symbols.add(part.text);
        }
        if(!symbols.size)return null;
        const start=model.getPositionAt(info.textSpan.start),end=model.getPositionAt(info.textSpan.start+info.textSpan.length);
        return {
          range:{startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column},
          contents:[{value:'View definition: '+[...symbols].map(link).join(' · '),isTrusted:false,supportHtml:false}],
        };
      } catch {return null;}
    },
  });
  return {documentation,dispose(){disposed=true;hover.dispose();opener.dispose();}};
}
