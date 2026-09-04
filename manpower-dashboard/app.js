const STORAGE_KEY = 'manpower-dashboard-v1';
const DAY = 86400000;
const seed = {
  members:[{id:'m1',name:'Aさん',capacity:100},{id:'m2',name:'Bさん',capacity:100},{id:'m3',name:'Cさん',capacity:100}],
  projects:[
    {id:'p1',name:'〇〇邸',memberId:'m1',start:'2026-09-01',end:'2026-09-20',volume:40},
    {id:'p2',name:'△△邸',memberId:'m1',start:'2026-09-10',end:'2026-09-30',volume:60},
    {id:'p3',name:'□□邸',memberId:'m2',start:'2026-09-05',end:'2026-09-25',volume:40},
    {id:'p4',name:'共同住宅C',memberId:'m3',start:'2026-09-10',end:'2026-10-05',volume:70}
  ], settings:{view:'week',anchor:'2026-09-01'}
};
let state = loadState();
const $ = s => document.querySelector(s);
const fmt = new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric'});

function loadState(){try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));return saved?.members&&saved?.projects?saved:structuredClone(seed)}catch{return structuredClone(seed)}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}
function date(s){return new Date(`${s}T00:00:00`)}
function iso(d){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function daysBetween(a,b){return Math.round((date(b)-date(a))/DAY)+1}
function esc(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function id(){return crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),1800)}

function periods(){
  const view=state.settings.view, anchor=date(state.settings.anchor), list=[];
  if(view==='week'){
    const start=addDays(anchor,-((anchor.getDay()+6)%7));
    for(let i=0;i<6;i++){const a=addDays(start,i*7);list.push({start:a,end:addDays(a,6),label:`${fmt.format(a)}〜${fmt.format(addDays(a,6))}`})}
  }else for(let i=0;i<14;i++){const a=addDays(anchor,i);list.push({start:a,end:a,label:`${fmt.format(a)}${['日','月','火','水','木','金','土'][a.getDay()]}`})}
  return list;
}
function projectLoadInPeriod(project,start,end){
  const ps=date(project.start),pe=date(project.end),a=new Date(Math.max(ps,start)),b=new Date(Math.min(pe,end));
  if(a>b)return 0;return (project.volume/daysBetween(project.start,project.end))*((b-a)/DAY+1);
}
function rateFor(member,period){
  const load=state.projects.filter(p=>p.memberId===member.id).reduce((s,p)=>s+projectLoadInPeriod(p,period.start,period.end),0);
  const periodDays=(period.end-period.start)/DAY+1;
  return member.capacity>0?load/(member.capacity*periodDays/30)*100:0;
}
function memberRate(member,ps=periods()){
  return Math.max(0,...ps.map(period=>rateFor(member,period)));
}
function classFor(r){return r===0?'load-none':r<=50?'load-low':r<=80?'load-mid':r<=100?'load-high':'load-over'}
function statusFor(r){return r>100?['要応援','over']:r>80?['注意','high']:r<=50?['余力あり','free']:['通常','normal']}

function render(){renderMap();renderSummary();renderMembers();renderProjects();renderSelects();save()}
function renderMap(){
  const ps=periods(),grid=$('#loadMap');grid.style.gridTemplateColumns=`150px repeat(${ps.length},minmax(${state.settings.view==='week'?105:66}px,1fr))`;
  let html='<div class="map-cell map-header member-cell">メンバー</div>'+ps.map(p=>`<div class="map-cell map-header">${p.label}</div>`).join('');
  if(!state.members.length)html+='<div class="empty">メンバーを追加してください</div>';
  state.members.forEach(m=>{html+=`<div class="map-cell member-cell"><strong>${esc(m.name)}</strong><span>基準 ${m.capacity}</span></div>`;ps.forEach(p=>{const r=rateFor(m,p),st=statusFor(r);html+=`<div class="map-cell load-cell ${classFor(r)}" title="${esc(m.name)} ${p.label}: ${r.toFixed(1)}%">${Math.round(r)}%${r>100?`<small>${st[0]}</small>`:''}</div>`})});
  grid.innerHTML=html;const first=ps[0],last=ps.at(-1);$('#summaryPeriod').textContent=`${fmt.format(first.start)}〜${fmt.format(last.end)}`;
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.settings.view));
}
function renderSummary(){
  const rates=state.members.map(m=>({m,r:memberRate(m)})).sort((a,b)=>b.r-a.r);
  const over=rates.filter(x=>x.r>100).length,warn=rates.filter(x=>x.r>80&&x.r<=100).length,free=rates.filter(x=>x.r<=50).length;
  $('#statusCounts').innerHTML=`<div class="count-tile over"><strong>${over}</strong><span>要応援</span></div><div class="count-tile warn"><strong>${warn}</strong><span>注意</span></div><div class="count-tile free"><strong>${free}</strong><span>余力あり</span></div>`;
  $('#memberRanking').innerHTML=rates.length?rates.slice(0,5).map(({m,r})=>{const s=statusFor(r);return `<div class="ranking-row"><div><strong>${esc(m.name)}</strong><div class="bar-track"><div class="bar-fill ${classFor(r)}" style="width:${Math.min(r,100)}%"></div></div></div><span class="rate">${Math.round(r)}%</span><span class="badge ${s[1]}">${s[0]}</span></div>`}).join(''):'<div class="support-empty">メンバーがいません</div>';
  const overloaded=rates.filter(x=>x.r>100), candidates=rates.filter(x=>x.r<=80).sort((a,b)=>a.r-b.r);
  $('#supportSuggestions').innerHTML=overloaded.length?overloaded.map(o=>`<div class="support-group"><strong>${esc(o.m.name)} ${Math.round(o.r)}% 要応援</strong><div class="support-candidates">${candidates.filter(c=>c.m.id!==o.m.id).slice(0,3).map(c=>`<span class="candidate">${esc(c.m.name)} ${Math.round(c.r)}%</span>`).join('')||'<span class="muted">候補なし</span>'}</div></div>`).join(''):'<div class="support-empty">現在、100%を超えるメンバーはいません。</div>';
}
function renderSelects(){
  const current=$('#projectMember').value,filter=$('#projectFilter').value,opts=state.members.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('');
  $('#projectMember').innerHTML=opts;$('#projectFilter').innerHTML='<option value="">すべて</option>'+opts;
  if(state.members.some(m=>m.id===current))$('#projectMember').value=current;if(state.members.some(m=>m.id===filter))$('#projectFilter').value=filter;
}
function renderMembers(){
  $('#memberList').innerHTML=state.members.length?state.members.map(m=>`<div class="member-item"><div><strong>${esc(m.name)}</strong><br><small>基準キャパシティ ${m.capacity}</small></div><button class="text-button" data-edit-member="${m.id}">編集</button><button class="text-button delete" data-delete-member="${m.id}">削除</button></div>`).join(''):'<div class="support-empty">メンバーがいません</div>';
}
function renderProjects(){
  const filter=$('#projectFilter').value,items=state.projects.filter(p=>!filter||p.memberId===filter).sort((a,b)=>a.start.localeCompare(b.start));
  $('#projectList').innerHTML=items.length?`<table class="project-table"><thead><tr><th>案件名</th><th>担当者</th><th>期間</th><th>ボリューム</th><th>操作</th></tr></thead><tbody>${items.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(state.members.find(m=>m.id===p.memberId)?.name||'未設定')}</td><td>${p.start.replaceAll('-','/')} 〜 ${p.end.replaceAll('-','/')}</td><td>${p.volume}</td><td><button class="text-button" data-edit-project="${p.id}">編集</button><button class="text-button delete" data-delete-project="${p.id}">削除</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">該当する案件はありません</div>';
}

$('#projectForm').addEventListener('submit',e=>{e.preventDefault();if(!state.members.length)return toast('先にメンバーを追加してください');const start=$('#projectStart').value,end=$('#projectEnd').value;if(start>end)return toast('終了日は開始日以降にしてください');const data={id:$('#projectId').value||id(),name:$('#projectName').value.trim(),memberId:$('#projectMember').value,start,end,volume:Number($('#projectVolume').value)};const i=state.projects.findIndex(p=>p.id===data.id);i<0?state.projects.push(data):state.projects[i]=data;resetProjectForm();render();toast(i<0?'案件を追加しました':'案件を更新しました')});
function resetProjectForm(){$('#projectForm').reset();$('#projectId').value='';$('#projectFormTitle').textContent='案件を追加';$('#cancelProjectEdit').classList.add('hidden')}
$('#cancelProjectEdit').onclick=resetProjectForm;
$('#projectList').addEventListener('click',e=>{const edit=e.target.dataset.editProject,del=e.target.dataset.deleteProject;if(edit){const p=state.projects.find(x=>x.id===edit);Object.entries({projectId:p.id,projectName:p.name,projectMember:p.memberId,projectStart:p.start,projectEnd:p.end,projectVolume:p.volume}).forEach(([k,v])=>$(`#${k}`).value=v);$('#projectFormTitle').textContent='案件を編集';$('#cancelProjectEdit').classList.remove('hidden');$('#projectForm').scrollIntoView({behavior:'smooth',block:'center'})}if(del&&confirm('この案件を削除しますか？')){state.projects=state.projects.filter(p=>p.id!==del);render();toast('案件を削除しました')}});
$('#projectFilter').addEventListener('change',renderProjects);

const dlg=$('#memberDialog');$('#addMemberButton').onclick=()=>{ $('#memberForm').reset();$('#memberId').value='';$('#memberCapacity').value=100;$('#memberDialogTitle').textContent='メンバーを追加';dlg.showModal()};$('#cancelMemberDialog').onclick=()=>dlg.close();
$('#memberForm').addEventListener('submit',e=>{e.preventDefault();const data={id:$('#memberId').value||id(),name:$('#memberName').value.trim(),capacity:Number($('#memberCapacity').value)};const i=state.members.findIndex(m=>m.id===data.id);i<0?state.members.push(data):state.members[i]=data;dlg.close();render();toast(i<0?'メンバーを追加しました':'メンバーを更新しました')});
$('#memberList').addEventListener('click',e=>{const edit=e.target.dataset.editMember,del=e.target.dataset.deleteMember;if(edit){const m=state.members.find(x=>x.id===edit);$('#memberId').value=m.id;$('#memberName').value=m.name;$('#memberCapacity').value=m.capacity;$('#memberDialogTitle').textContent='メンバーを編集';dlg.showModal()}if(del){const m=state.members.find(x=>x.id===del),count=state.projects.filter(p=>p.memberId===del).length;if(confirm(`${m.name}を削除しますか？${count?`\n担当する案件 ${count}件も削除されます。`:''}`)){state.members=state.members.filter(x=>x.id!==del);state.projects=state.projects.filter(p=>p.memberId!==del);render();toast('メンバーを削除しました')}}});

document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.settings.view=b.dataset.view;render()});
$('#prevPeriod').onclick=()=>{state.settings.anchor=iso(addDays(date(state.settings.anchor),state.settings.view==='week'?-42:-14));render()};
$('#nextPeriod').onclick=()=>{state.settings.anchor=iso(addDays(date(state.settings.anchor),state.settings.view==='week'?42:14));render()};
$('#todayButton').onclick=()=>{state.settings.anchor=iso(new Date());render()};
$('#resetButton').onclick=()=>{if(confirm('メンバー・案件・設定を初期状態に戻しますか？\nこの操作は取り消せません。')){state=structuredClone(seed);localStorage.removeItem(STORAGE_KEY);resetProjectForm();render();toast('サンプルデータに戻しました')}};
render();
