import {parse,tokenizer} from './vendor/acorn.mjs';
// Bind direct inline liveLoop callbacks lexically, so await cannot mix loop state.
export function bindLoopContext(source) {
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true,allowReturnOutsideFunction:true});
  const edits=[];
  const isPgMember=(node,name)=>node?.type==='MemberExpression'&&!node.computed&&node.object.type==='Identifier'&&node.object.name==='pg'&&node.property.name===name;
  const isLiveLoop=node=>node?.type==='CallExpression'&&((node.callee.type==='Identifier'&&node.callee.name==='liveLoop')||isPgMember(node.callee,'liveLoop'));
  const outputNames=new Set();
  function findOutputs(n){
    if(!n||typeof n!=='object')return;
    if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init?.type==='CallExpression'&&n.init.callee.type==='MemberExpression'&&(n.init.callee.object.name==='midi'||isPgMember(n.init.callee.object,'midi'))&&n.init.callee.property.name==='output')outputNames.add(n.id.name);
    for(const v of Object.values(n))if(Array.isArray(v))v.forEach(findOutputs);else if(v&&typeof v==='object')findOutputs(v);
  }
  findOutputs(ast);
  const names=['play','beat','nextBeat','cycle','playOutput','pg','noteOn','noteOff','cc','programChange','pitchBend','channelPressure','polyPressure','send'];
  function walk(node){
    if(!node||typeof node!=='object')return;
    if(isLiveLoop(node)){
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
          // Route handle.play calls through this callback's lexical owner.
          function routeCalls(n){
            if(!n||typeof n!=='object')return;
            if(isLiveLoop(n))return;
            if(n.type==='CallExpression' && n.callee.type==='MemberExpression' && !n.callee.computed && n.callee.property.name==='play' && n.callee.object.type==='Identifier' && outputNames.has(n.callee.object.name)) {
              const obj=source.slice(n.callee.object.start,n.callee.object.end);
              edits.push({at:n.callee.start,end:n.callee.end,text:'playOutput'});
              edits.push({at:n.arguments[0]?.start ?? n.end-1,text:obj+(n.arguments.length?',':'')});
            }
            for(const v of Object.values(n))if(Array.isArray(v))v.forEach(routeCalls);else if(v&&typeof v==='object')routeCalls(v);
          }
          if(!declared.has('playOutput'))routeCalls(fn.body);
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
  for(const edit of edits.sort((a,b)=>b.at-a.at))source=source.slice(0,edit.at)+edit.text+source.slice(edit.end??edit.at);
  return source;
}
