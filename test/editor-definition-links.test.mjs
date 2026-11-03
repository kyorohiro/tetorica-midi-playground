import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerDefinitionLinks} from '../ui/editor-definition-links.js';

function setup(worker) {
 let opener,hover;const opened=[],disposed=[];
 const monaco={editor:{registerLinkOpener(value){opener=value;return {dispose:()=>disposed.push('opener')};}},languages:{
  registerHoverProvider(_,value){hover=value;return {dispose:()=>disposed.push('hover')};},
  typescript:{getJavaScriptWorker:async()=>async()=>worker},
 }};
 const links=registerDefinitionLinks(monaco,{openSymbol:symbol=>opened.push(symbol)});
 return {links,opened,disposed,get opener(){return opener;},get hover(){return hover;}};
}
const resource=path=>({scheme:'file',authority:'',path,query:'',fragment:''});

test('definition links open only real API symbols inside the internal namespace',()=>{
 const {links,opener,opened,disposed}=setup();
 for(const symbol of ['MidiOutput','MidiOutput.play','MidiPlayOptions'])assert.equal(opener.open(resource('/tetorica-definition/'+symbol)),true);
 assert.deepEqual(opened,['MidiOutput','MidiOutput.play','MidiPlayOptions']);
 for(const path of ['/tetorica-definition/unknown','/tetorica-definition/../runner.js','/tetorica-definition/MidiOutput?payload'])assert.equal(opener.open(resource(path)),true);
 assert.equal(opener.open({...resource('/tetorica-definition/MidiOutput'),authority:'remote'}),true);
 assert.equal(opener.open({...resource('/tetorica-definition/MidiOutput'),query:'anything'}),true);
 assert.equal(opener.open(resource('/other/file.js')),false);
 assert.equal(opener.open({...resource('/tetorica-definition/MidiOutput'),scheme:'https'}),false);
 assert.equal(opened.length,3);
 links.dispose();assert.deepEqual(disposed,['hover','opener']);
 opener.open(resource('/tetorica-definition/MidiOutput'));assert.equal(opened.length,3);
});

test('completion documentation links API types while keeping arbitrary text untrusted',()=>{
 const {links}=setup();
 const docs=links.documentation('midi.output returns MidiOutput; use MidiPlayOptions. <script> [unsafe](command:run)', 'midi.output');
 assert.match(docs.value,/\[MidiOutput\]\(file:\/\/\/tetorica-definition\/MidiOutput\)/);
 assert.match(docs.value,/\[MidiPlayOptions\]\(file:\/\/\/tetorica-definition\/MidiPlayOptions\)/);
 assert.match(docs.value,/View definition: \[midi.output\]/);
 assert.equal(docs.isTrusted,false);assert.equal(docs.supportHtml,false);
 assert.ok(!docs.value.includes('<script>'));assert.ok(!docs.value.includes('[unsafe](command:run)'));
 assert.ok(!links.documentation('custom', '../runner.js').value.includes('View definition:'));
 links.dispose();
});

test('hover preserves local bindings and links members resolved to API declarations',async()=>{
 let api=false;
 const worker={
  getQuickInfoAtPosition:async()=>({textSpan:{start:0,length:4},displayParts:[{text:'play',kind:'functionName'}]}),
  getDefinitionAtPosition:async()=>[{fileName:api?'file:///tetorica-api.d.ts':'file:///index.js',name:'play',containerName:api?'MidiOutput':''}],
 };
 const {hover,links}=setup(worker);
 const model={uri:{scheme:'file',toString:()=> 'file:///index.js'},getVersionId:()=>1,getLanguageId:()=> 'javascript',isDisposed:()=>false,getOffsetAt:()=>0,getPositionAt:offset=>({lineNumber:1,column:offset+1})};
 assert.equal(await hover.provideHover(model,{lineNumber:1,column:1},{}),null);
 api=true;
 const result=await hover.provideHover(model,{lineNumber:1,column:1},{});
 assert.match(result.contents[0].value,/MidiOutput.play/);
 assert.equal(result.contents[0].isTrusted,false);
 assert.equal(await hover.provideHover(model,{lineNumber:1,column:1},{isCancellationRequested:true}),null);
 links.dispose();
});
