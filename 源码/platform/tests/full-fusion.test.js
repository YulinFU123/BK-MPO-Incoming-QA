'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {createWorkspaceController} = require('../desktop/workspace-controller');
const {createUnifiedRepository,restoreUnifiedBackup}=require('../adapters/encrypted/repository');
const {legacyRoot,legacyAnalysisProjection}=require('../adapters/legacy/full-state');
const fixture=require('../fixtures/synthetic.json');
const config=require('../fixtures/excel-mapping.example.json');
const QA=process.env.PLATFORM_QA_ROOT || path.resolve(__dirname,'../../../构建/当前作业/测试');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('original encrypted records import preserves every v1 field and BI facts, backs up first and leaves source unchanged',async()=>{
  fs.mkdirSync(QA,{recursive:true});const folder=fs.mkdtempSync(path.join(QA,'complete-fusion-'));
  const workspace=path.join(folder,'融合.eap'),original=path.join(folder,'原记录只读.json');
  const {Vault}=require(path.join(legacyRoot(),'vault'));
  const raw=structuredClone(fixture.legacyState);
  raw.records[0].values.found_date='10/26/2026';
  raw.records[0].workflow={status:'处理中',owner:'合成QA',dueDate:'2026-10-30',result:'合成处理'};
  raw.records[0].history=[{action:'合成修改',at:'2026-10-26T02:00:00.000Z',values:{sn:'0001Ab'}}];
  raw.deletedRecords=[structuredClone(raw.records[1])];raw.batchDraft={templateId:'incoming',snId:'sn',values:{process:'装管'},codes:['QA0001']};
  raw.pendingUI={templateId:'incoming',values:{sn:'UNFINISHED'},savedLocalDate:'2026-10-27'};
  raw.security={idleMinutes:15};raw.futureConfig={keep:['0012','AB12']};
  const originalVault=new Vault(original);await originalVault.setup('Original-QA-2026!',raw);originalVault.lock();const originalSha=hash(original);
  const controller=createWorkspaceController({legacyEnabled:true,repositoryFactory:createUnifiedRepository,restoreFactory:restoreUnifiedBackup,dialogs:{chooseWorkspace:async()=>workspace,pickWorkbook:async()=>path.join(__dirname,'fixtures/openpyxl-synthetic-quality.xlsx')}});
  const selected=await controller.chooseWorkspace({create:true});await controller.unlock({selectionToken:selected.selectionToken,password:'Unified-QA-2026!'});
  await controller.legacyBootstrap(structuredClone(fixture.legacyState));
  const book=await controller.pickWorkbook();const preview=await controller.previewImport({...config,workbookToken:book.workbookToken});await controller.commitImport({previewId:preview.previewId,acknowledgeWarnings:true});
  const before=await controller.catalog();
  const encrypted=fs.readFileSync(original,'utf8');
  await assert.rejects(controller.importLegacyRecords({raw:encrypted,password:'Original-QA-2026!'}),error=>error.code==='LEGACY_REPLACE_CONFIRMATION_REQUIRED');
  const result=await controller.importLegacyRecords({raw:encrypted,password:'Original-QA-2026!',replaceConfirmed:true});
  assert.equal(result.importedCount,2);assert.equal(result.backupCreated,true);assert.equal(hash(original),originalSha);
  assert.deepEqual(await controller.legacyBootstrap(null),raw);
  assert.equal((await controller.catalog()).batches.length,before.batches.length);
  assert.equal((await controller.overview({start:'2026-10-26',end:'2026-10-26',datasetId:config.dataset.id})).quality.rate.value,0.02);
  assert.equal(legacyAnalysisProjection(raw).observations[0].observedOn,'2026-10-26');
  assert.equal(raw.records[0].values.found_date,'10/26/2026');
  controller.legacySave(raw);
  assert.ok(fs.readdirSync(workspace+'.backups').some(name=>name.endsWith('.eap')));
  await controller.lock();
  const reopened=await createUnifiedRepository({file:workspace,password:'Unified-QA-2026!'});
  try{const state=await reopened.snapshot();assert.deepEqual(state.legacyState,raw);assert.equal(state.facts.length,2);}finally{await reopened.close();}
  assert.equal(hash(original),originalSha);
});

test('demo bootstrap inherits complete original field rules without losing sample records',async()=>{
  const controller=createWorkspaceController({dialogs:{},legacyEnabled:true});await controller.openDemo();
  const defaults=structuredClone(fixture.legacyState);defaults.records=[];
  defaults.templates[0].columns=defaults.templates[0].columns.map(column=>({...column,required:['sn','issue','silk'].includes(column.id),auto:column.id==='found_date'?'today':'none'}));
  const complete=await controller.legacyBootstrap(defaults);
  assert.ok(complete.records.length>30);assert.equal(complete.templates[0].columns.find(column=>column.id==='sn').required,true);
  assert.equal(complete.templates[0].columns.find(column=>column.id==='found_date').auto,'today');
  await controller.lock();
});
