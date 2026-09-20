import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fmFields,readFmPatch} from '../ui/fm-editor.js';
test('FM form preserves distinct operators and rejects invalid register values',()=>{
 const values={algorithm:'7',feedback:'6'};
 for(let i=0;i<4;i++)for(const [key,,max] of fmFields)values[`op${i}_${key}`]=String(Math.min(i,max));
 const form={elements:{namedItem:name=>({value:values[name]})}};
 const p=readFmPatch(form);assert.equal(p.algorithm,7);assert.equal(p.feedback,6);
 assert.deepEqual(p.operators.map(o=>o.multi),[0,1,2,3]);
 for(const invalid of ['', '1.5','32','-1','NaN']){
  values.op0_ar=invalid;assert.throws(()=>readFmPatch(form),/op0_ar/);
 }
});
