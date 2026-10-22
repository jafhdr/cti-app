const assert=require('node:assert/strict');const test=require('node:test');const {randomUUID}=require('node:crypto');const fs=require('node:fs');
const line=fs.readFileSync('.env','utf8').split(/\r?\n/).find(x=>x.startsWith('DATABASE_URL='));const url=new URL(line.slice(13).replace(/^"|"$/g,''));if(!['localhost','127.0.0.1'].includes(url.hostname))throw Error('Local QA only');url.pathname='/cti_db13_qa';process.env.DATABASE_URL=url.toString();
const {PrismaClient,Prisma}=require('@prisma/client');const {PrismaService}=require('../../dist/src/prisma.service');const {Test}=require('@nestjs/testing');const {ConfigModule}=require('@nestjs/config');const {ValidationPipe}=require('@nestjs/common');const cookieParser=require('cookie-parser');
const {DashboardModule}=require('../../dist/src/dashboard/dashboard.module');const {ModuleAccessService}=require('../../dist/src/auth/module-access.service');const {createAccessToken}=require('../auth/integration-session.cjs');
test('Unified feed authorizes and paginates four interleaved sources over HTTP and PostgreSQL',{timeout:120000},async()=>{
 const db=new PrismaClient();const marker=randomUUID();const tenants=[];const users=[];const createdModules=[];let app;const failedSources=new Set();
 try{
 for(const label of ['a','b'])tenants.push(await db.tenant.create({data:{name:`db16 ${label}`,slug:`db16-${label}-${marker}`}}));const [a,b]=tenants;
 for(const [label,role,tenantId]of [['alice','ADMIN',a.id],['bob','USER',a.id],['denied','USER',a.id],['foreign','ADMIN',b.id],['root','SUPER_ADMIN',null]])users.push(await db.user.create({data:{name:label,email:`${label}-${marker}@example.test`,role,tenantId,passwordHash:'qa'}}));const [alice,bob,denied,foreign,root]=users;
 const features={'attack-surface-management':'asset-management','case-management':'case-workflow','appsec-posture':'finding-management','threat-intelligence':'indicator-management'};const modules=[];
 const sub=await db.tenantSubscription.create({data:{tenantId:a.id,isCustom:true,status:'ACTIVE',billingCycle:'MONTHLY',priceMonthly:0,renewalAt:new Date(Date.now()+86400000)}});
 for(const [slug,key]of Object.entries(features)){
 let m=await db.appModule.findUnique({where:{slug}});if(!m){m=await db.appModule.create({data:{slug,name:slug,description:'QA',category:'CTI'}});createdModules.push(m.id);}modules.push(m);
 await db.moduleFeature.upsert({where:{moduleId_key:{moduleId:m.id,key}},update:{},create:{moduleId:m.id,key,name:key,description:'QA'}});
 await db.tenantCustomModule.create({data:{subscriptionId:sub.id,moduleId:m.id}});const setting=await db.tenantModule.create({data:{tenantId:a.id,moduleId:m.id,isEnabled:true}});
 await db.moduleRoleAccess.createMany({data:['ADMIN','USER'].map(role=>({tenantModuleId:setting.id,role,isAllowed:true}))});
 for(const u of [alice,bob,denied])await db.userModuleAccess.create({data:{userId:u.id,tenantId:a.id,moduleId:m.id,featureKeys:[key]}});
 }
 const asset=await db.asset.create({data:{tenantId:a.id,name:'QA Asset',type:'DOMAIN',value:`db16-${marker}.test`}});
 const caseItem=await db.case.create({data:{tenantId:a.id,title:'QA Case',caseNumber:`QA-${marker}`,createdBy:alice.id}});
 const application=await db.application.create({data:{tenantId:a.id,name:'QA App'}});
 const finding=await db.appSecFinding.create({data:{tenantId:a.id,applicationId:application.id,title:'QA Finding',severity:'HIGH'}});
 const indicator=await db.indicator.create({data:{tenantId:a.id,type:'DOMAIN',value:`db16-${marker}.test`}});
 const sources=[['CASE','CASE',caseItem.id,'CASE_ASSIGNED'],['APPSEC','APPSEC_FINDING',finding.id,'APPSEC_FINDING_REOPENED'],['THREAT_INTELLIGENCE','INDICATOR',indicator.id,'INDICATOR_ENRICHMENT_COMPLETED']];
 for(let i=0;i<120;i++){
 const at=new Date(Date.UTC(2026,9,1,0,0,Math.floor(i/2)));
 if(i%4===0){const alert=await db.alert.create({data:{tenantId:a.id,assetId:asset.id,title:`Legacy ${i}`,severity:'HIGH',source:'ASM',sourceKey:`${marker}:${i}`}});await db.asmNotification.update({where:{alertId:alert.id},data:{createdAt:at,utcCreatedAt:at}});}
 else{const [sourceModule,resourceKind,resourceId,type]=sources[i%4-1];const notice=await db.notification.create({data:{tenantId:a.id,sourceModule,resourceKind,resourceId,type,preview:`Safe QA ${i}`,priority:'HIGH',route:'https://untrusted.invalid',eventAt:at,dedupeKey:`db16-${i}`}});await db.notificationRecipient.createMany({data:[alice,bob].map(u=>({notificationId:notice.id,tenantId:a.id,userId:u.id}))});}
 }
 const unavailable=statement=>['AsmNotification','Case','AppSecFinding','Indicator'].some(table=>failedSources.has(table)&&statement.sql.includes('FROM "'+table+'"'));
 const failure=()=>new Prisma.PrismaClientKnownRequestError('QA source unavailable',{code:'P2010',clientVersion:'QA',meta:{code:'42P01'}});
 const faulty=new Proxy(db,{get(target,key){if(key==='$queryRaw')return async statement=>{if(unavailable(statement))throw failure();return target.$queryRaw(statement);};if(key==='$transaction')return callback=>target.$transaction(async tx=>callback(new Proxy(tx,{get(inner,operation){if(operation==='$queryRaw')return async statement=>{if(unavailable(statement))throw failure();return inner.$queryRaw(statement);};return Reflect.get(inner,operation);}})));const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const ref=await Test.createTestingModule({imports:[ConfigModule.forRoot({isGlobal:true}),DashboardModule]}).overrideProvider(PrismaService).useValue(faulty).compile();app=ref.createNestApplication({logger:false});app.use(cookieParser());app.useGlobalPipes(new ValidationPipe({whitelist:true,transform:true}));await app.listen(0,'127.0.0.1');const base=`http://127.0.0.1:${app.getHttpServer().address().port}`;
 const tokens=new Map(await Promise.all(users.map(async u=>[u.id,await createAccessToken(db,u.id,process.env.JWT_ACCESS_SECRET)])));
 const request=(path,u=alice,method='GET')=>fetch(base+path,{method,headers:u?{Authorization:`Bearer ${tokens.get(u.id)}`}:{}});const path='/dashboard/notifications';
 assert.equal((await request(path,null)).status,401);assert.equal((await request(path,root)).status,400);assert.equal((await request(`${path}?tenantId=${b.id}`)).status,403);
 const all=[];for(let page=1;page<=6;page++){const response=await request(`${path}?limit=20&page=${page}`);assert.equal(response.status,200,await response.clone().text());const body=await response.json();assert.equal(body.total,120);assert.equal(body.unreadCount,120);assert.equal(body.items.length,20);assert.equal(body.hasMore,page<6);all.push(...body.items);}
 assert.equal(new Set(all.map(x=>x.id)).size,120);assert.deepEqual(new Set(all.map(x=>x.sourceModule)),new Set(['ASM','Case','AppSec','TI']));
 for(let i=1;i<all.length;i++){assert.ok(Date.parse(all[i-1].createdAt)>=Date.parse(all[i].createdAt));if(all[i-1].createdAt===all[i].createdAt)assert.ok(all[i-1].id>all[i].id);}
 assert.ok(all.every(x=>!x.route||x.route.startsWith('/')));assert.equal((await(await request(`${path}?page=1000`)).json()).total,120);
 const snapshot=(await(await request(path)).json()).snapshotAt;
 const arriving=await db.notification.create({data:{tenantId:a.id,sourceModule:'CASE',resourceKind:'CASE',resourceId:caseItem.id,type:'CASE_ASSIGNED',preview:'Arrived later',eventAt:new Date(),dedupeKey:'later'}});
 await db.notificationRecipient.create({data:{notificationId:arriving.id,tenantId:a.id,userId:alice.id}});
 assert.equal((await(await request(path+'?snapshotAt='+encodeURIComponent(snapshot))).json()).total,120);assert.equal((await(await request(path)).json()).total,121);await db.notification.delete({where:{id:arriving.id}});
 const shared=all.find(x=>x.id.startsWith('shared:'));const legacy=all.find(x=>!x.id.startsWith('shared:'));
 const read=await(await request(`${path}/${encodeURIComponent(shared.id)}/read`,alice,'PATCH')).json();const again=await(await request(`${path}/${encodeURIComponent(shared.id)}/read`,alice,'PATCH')).json();assert.equal(read.readAt,again.readAt);assert.ok(read.route.startsWith('/'));
 assert.equal((await(await request(path)).json()).unreadCount,119);assert.equal((await(await request(path,bob)).json()).unreadCount,120);
 assert.equal((await request(`${path}/${encodeURIComponent(shared.id)}/read`,denied,'PATCH')).status,404);
 assert.equal((await request(`${path}/${encodeURIComponent(shared.id)}/read`,foreign,'PATCH')).status,403);
 assert.equal((await request(`${path}/${legacy.id}/read`,bob,'PATCH')).status,200);assert.equal((await(await request(path,bob)).json()).unreadCount,119);
 assert.equal((await(await request(path,denied)).json()).total,30,'newly eligible user sees historical ASM only');
 const rootFeed=await(await request(`${path}?tenantId=${a.id}`,root)).json();assert.equal(rootFeed.total,30);assert.ok(rootFeed.items.every(x=>x.sourceModule==='ASM'));assert.ok(rootFeed.items.every(x=>x.route.includes(`tenantId=${a.id}`)));
 failedSources.add('AppSecFinding');const partial=await(await request(path)).json();assert.equal(partial.total,90);assert.deepEqual(partial.partialFailures,['AppSec']);assert.equal(partial.countsPartial,true);assert.equal(partial.unreadCount,90-Number(shared.sourceModule!=='AppSec'));
 const healthyCase=all.find(x=>x.sourceModule==='Case');assert.equal((await request(`${path}/${encodeURIComponent(healthyCase.id)}/read`,alice,'PATCH')).status,200,'Case PATCH survives unrelated AppSec outage');failedSources.clear();
 for(const [down,healthy] of [['AsmNotification','Case'],['AppSecFinding','TI'],['Case','AppSec'],['Indicator','ASM']]){failedSources.add(down);const target=all.find(item=>item.sourceModule===healthy);assert.equal((await request(`${path}/${encodeURIComponent(target.id)}/read`,alice,'PATCH')).status,200,`${healthy} survives ${down} outage`);failedSources.clear();}
 failedSources.add('AsmNotification');failedSources.add('AppSecFinding');const healthyTi=all.find(item=>item.sourceModule==='TI');assert.equal((await request(`${path}/${encodeURIComponent(healthyTi.id)}/read`,alice,'PATCH')).status,200);failedSources.clear();
 failedSources.add('Case');const failedTarget=all.find(item=>item.sourceModule==='Case');assert.equal((await request(`${path}/${encodeURIComponent(failedTarget.id)}/read`,alice,'PATCH')).status,500);failedSources.clear();
 failedSources.add('AsmNotification');failedSources.add('AppSecFinding');const twoDown=await(await request(path)).json();assert.equal(twoDown.total,60);assert.deepEqual(twoDown.partialFailures,['ASM','AppSec']);failedSources.clear();
 for(const down of ['AsmNotification','Case','AppSecFinding','Indicator'])failedSources.add(down);assert.equal((await request(path)).status,500);failedSources.clear();
 const accessService=app.get(ModuleAccessService);const originalEvaluate=accessService.evaluate;accessService.evaluate=async()=>{throw Error('QA authorization dependency unavailable')};try{assert.equal((await request(`${path}/${encodeURIComponent(healthyCase.id)}/read`,bob,'PATCH')).status,500);assert.equal((await db.notificationRecipient.findUniqueOrThrow({where:{notificationId_userId:{notificationId:healthyCase.id.slice(7),userId:bob.id}}})).readAt,null);}finally{accessService.evaluate=originalEvaluate;}
 const ti=modules.find(x=>x.slug==='threat-intelligence');await db.userModuleAccess.update({where:{userId_tenantId_moduleId:{userId:alice.id,tenantId:a.id,moduleId:ti.id}},data:{featureKeys:[]}});assert.equal((await(await request(path)).json()).total,90);const revokedTi=all.find(item=>item.sourceModule==='TI');assert.equal((await request(`${path}/${encodeURIComponent(revokedTi.id)}/read`,alice,'PATCH')).status,404);
 await db.case.delete({where:{id:caseItem.id}});assert.equal((await(await request(path)).json()).total,60,'deleted Case targets excluded from totals');
 const caseNotice=all.find(x=>x.sourceModule==='Case');assert.equal((await request(`${path}/${encodeURIComponent(caseNotice.id)}/read`,alice,'PATCH')).status,404);
 await db.tenantSubscription.update({where:{id:sub.id},data:{renewalAt:new Date(Date.now()-1000)}});assert.equal((await request(path)).status,403);
 }finally{
 if(app)await app.close();const ids=tenants.map(x=>x.id);
 if(ids.length){
 for(const table of ['notificationRecipient','notification','alert','asset','appSecFinding','application','case','indicator','userModuleAccess','tenantModule','tenantSubscription'])await db[table].deleteMany({where:{tenantId:{in:ids}}});
 await db.user.deleteMany({where:{id:{in:users.map(x=>x.id)}}});await db.tenant.deleteMany({where:{id:{in:ids}}});await db.appModule.deleteMany({where:{id:{in:createdModules}}});}
 await db.$disconnect();
 }
});
