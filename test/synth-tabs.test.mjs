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

function dockFixture() {
 const make=()=>({hidden:false,attrs:{},handlers:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.handlers[k]=v;},focus(){this.focused=true;}});
 const names=['code','operator','synthA','synthB','mixer','console','shell','keyboard','helpers'];
 const tabs=Object.fromEntries(names.map(name=>[name,{button:make(),panel:make()}]));
 const dock=make(),dockDivider=make(),dockToggle=make(),dockClose=make(),visits=[];
 const ui=createPlaygroundUi({dockedPanels:true,primaryTabs:['code','operator','synthA','synthB','mixer'],
   codeTab:tabs.code.button,codePanel:tabs.code.panel,
   operatorTabButton:tabs.operator.button,operatorPanel:tabs.operator.panel,
   consoleTab:tabs.console.button,consolePanel:tabs.console.panel,
   keyboardTab:tabs.keyboard.button,keyboardPanel:tabs.keyboard.panel,
   helpersTab:tabs.helpers.button,helpersPanel:tabs.helpers.panel,
   extraTabs:['shell','synthA','synthB','mixer'].map(name=>({name,...tabs[name]})),
   dock,dockDivider,dockToggle,dockClose,onBottomTabChange:(name,state)=>visits.push({name,state})});
 ui.installBottomTabHandlers();ui.setBottomTab('code');
 return {ui,tabs,dock,dockDivider,dockToggle,dockClose,visits};
}

test('primary MIDI and Mixer preserve the independently selected bottom tools',()=>{
 const {ui,tabs,visits}=dockFixture();
 assert.equal(tabs.code.panel.hidden,false);assert.equal(tabs.console.panel.hidden,false);
 ui.setBottomTab('shell');ui.setBottomTab('operator');
 assert.equal(tabs.operator.panel.hidden,false);assert.equal(tabs.shell.panel.hidden,false);
 assert.equal(tabs.console.panel.hidden,true);assert.equal(tabs.code.panel.hidden,true);
 ui.setBottomTab('keyboard');ui.setBottomTab('mixer');
 assert.equal(tabs.keyboard.panel.hidden,false);assert.equal(tabs.mixer.panel.hidden,false);
 assert.deepEqual(ui.getTabState(),{primaryTab:'mixer',bottomTab:'keyboard',dockOpen:true});
 assert.deepEqual(visits.at(-1),{name:'mixer',state:{primaryTab:'mixer',bottomTab:'keyboard',dockOpen:true}});
});

test('closing and restoring dock preserves selection; selecting a bottom tab reopens it',()=>{
 const {ui,tabs,dock,dockDivider,dockToggle,dockClose}=dockFixture();
 ui.setBottomTab('keyboard');dockClose.handlers.click();
 assert.equal(dock.hidden,true);assert.equal(dockDivider.hidden,true);
 assert.equal(tabs.code.panel.hidden,false);assert.equal(tabs.keyboard.panel.hidden,true);
 assert.equal(dockToggle.attrs['aria-expanded'],'false');
 ui.setBottomTab('synthA');assert.equal(dock.hidden,true);
 dockToggle.handlers.click();
 assert.equal(dock.hidden,false);assert.equal(tabs.keyboard.panel.hidden,false);
 ui.setDockVisible(false);ui.setBottomTab('shell');
 assert.equal(dock.hidden,false);assert.equal(tabs.shell.panel.hidden,false);
});

test('tab navigation stays within its row and supports Home/End with roving focus',()=>{
 const {ui,tabs}=dockFixture();
 const key=(name,value)=>tabs[name].button.handlers.keydown({key:value,preventDefault(){}});
 ui.setBottomTab('mixer');key('mixer','ArrowRight');
 assert.equal(tabs.code.button.focused,true);assert.equal(ui.getTabState().bottomTab,'console');
 key('code','End');assert.equal(ui.getTabState().primaryTab,'mixer');
 key('mixer','Home');assert.equal(ui.getTabState().primaryTab,'code');
 ui.setBottomTab('console');key('console','ArrowRight');
 assert.equal(ui.getTabState().bottomTab,'shell');assert.equal(ui.getTabState().primaryTab,'code');
 key('shell','End');assert.equal(ui.getTabState().bottomTab,'helpers');
 key('helpers','Home');assert.equal(ui.getTabState().bottomTab,'console');
 assert.equal(tabs.console.button.attrs.tabindex,'0');assert.equal(tabs.shell.button.attrs.tabindex,'-1');
 assert.equal(tabs.code.button.attrs.tabindex,'0');
 ui.setBottomTab('missing');assert.equal(ui.getTabState().bottomTab,'console');
});
