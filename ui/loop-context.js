import {parse,tokenizer} from './vendor/acorn.mjs';
// Bind direct inline liveLoop callbacks lexically, so await cannot mix loop state.
export function bindLoopContext(source) {
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true});
  const edits=[];
  const names=['play','beat','nextBeat','cycle'];
  function walk(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='CallExpression'&&node.callee.type==='Identifier'&&node.callee.name==='liveLoop'){
      const fn=node.arguments[1];
      if(fn&&['ArrowFunctionExpression','FunctionExpression'].includes(fn.type)&&fn.params.length===0){
        // Inserting lexical bindings in the body preserves closure variables and comments.
        if(fn.body.type==='BlockStatement') {
          const declared=new Set();
          function pattern(n){if(!n)return;if(n.type==='Identifier')declared.add(n.name);else for(const v of Object.values(n))if(Array.isArray(v))v.forEach(pattern);else if(v&&typeof v==='object')pattern(v);}
          for(const statement of fn.body.body){
            if(statement.type==='VariableDeclaration')statement.declarations.forEach(d=>pattern(d.id));
            if(['FunctionDeclaration','ClassDeclaration'].includes(statement.type))pattern(statement.id);
          }
          const bound=names.filter(n=>!declared.has(n));
          // Rewrite the empty parameter list using token positions from the parser.
          const tokens=[...tokenizer(source.slice(fn.start,fn.body.start),{ecmaVersion:'latest'})];
          const close=tokens.find(t=>t.type.label===')');
          if(close)edits.push({at:fn.start+close.start,text:`{${bound.join(',')}}`});
        }
      }
    }
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);
  }
  walk(ast);
  for(const edit of edits.sort((a,b)=>b.at-a.at))source=source.slice(0,edit.at)+edit.text+source.slice(edit.at);
  return source;
}
