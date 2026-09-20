import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundUi} from '../ui/shared/playground_ui.js';
test('native rack tabs share navigation and leave Keyboard audition mode',()=>{
 const make=()=>({hidden:false,attrs:{},handlers:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.handlers[k]=v;},focus(){this.focused=true;}});
 const keyboardTab=make(),keyboardPanel=make(),visits=[];
 const extraTabs=['synthA','synthB','mixer'].map(name=>({name,button:make(),panel:make()}));
 const ui=createPlaygroundUi({keyboardTab,keyboardPanel,extraTabs,onBottomTabChange:name=>visits.push(name)});
 ui.installBottomTabHandlers();ui.setBottomTab('keyboard');
 extraTabs[0].button.handlers.click();
 assert.equal(keyboardPanel.hidden,true);assert.equal(extraTabs[0].panel.hidden,false);
 extraTabs[0].button.handlers.keydown({key:'ArrowRight',preventDefault(){}});
 assert.equal(extraTabs[0].panel.hidden,true);assert.equal(extraTabs[1].panel.hidden,false);
 ui.setBottomTab('mixer');assert.deepEqual(visits,['keyboard','synthA','synthB','mixer']);
 assert.equal(extraTabs[2].button.attrs['aria-selected'],'true');
});
