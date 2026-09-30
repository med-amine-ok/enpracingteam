const ICONS={dashboard:'<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',membres:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14c2.2.6 3.5 2.6 3.5 5"/>',communication:'<path d="M21 12a8 8 0 01-11.6 7.1L3 20.5l1.4-5.2A8 8 0 1121 12z"/>',documents:'<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',projets:'<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9"/>',achats:'<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 002 1.6h7.7a2 2 0 002-1.5L21 8H6"/>',stocks:'<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',ateliers:'<path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'};
const DEPTS=['Systèmes d’information','Châssis','Aérodynamique','Électronique','Suspension','Moteur','Communication','Finance'];
const F=(k,l,t='text',o,req)=>({k,l,t,o,req});
const M={
 membres:{label:'Membres',one:'un membre',fields:[F('nom','Nom','text',0,1),F('dept','Département','select',DEPTS),F('role','Rôle','select',['Membre','Chef d’unité','Bureau']),F('statut','Statut','select',['Actif','Inactif'])]},
 communication:{label:'Communication',one:'une publication',fields:[F('titre','Titre','text',0,1),F('type','Type','select',['Annonce','Décision','Compte rendu']),F('auteur','Auteur','text'),F('date','Date','date'),F('statut','Statut','select',['Publié','Brouillon'])]},
 documents:{label:'Documents',one:'un document',fields:[F('nom','Fichier','text',0,1),F('projet','Projet','text'),F('version','Version','text'),F('statut','Statut','select',['Validé','En attente','Obsolète'])]},
 projets:{label:'Projets',one:'un projet',fields:[F('nom','Projet','text',0,1),F('resp','Responsable','text'),F('avancement','Avancement (%)','number'),F('echeance','Échéance','date'),F('statut','Statut','select',['En cours','Urgent','Terminé'])]},
 achats:{label:'Achats',one:'une demande d’achat',fields:[F('article','Article','text',0,1),F('fournisseur','Fournisseur','text'),F('montant','Montant (DA)','number'),F('date','Date','date'),F('statut','Statut','select',['En attente','En cours','Livré'])]},
 stocks:{label:'Stocks',one:'un article',fields:[F('article','Article','text',0,1),F('qte','Quantité','number'),F('seuil','Seuil d’alerte','number'),F('lieu','Emplacement','text')],status:r=>+r.qte<=+r.seuil?'Stock bas':'OK'},
 ateliers:{label:'Ateliers',one:'un équipement',fields:[F('nom','Équipement','text',0,1),F('atelier','Atelier','text'),F('resp','Réservé par','text'),F('statut','Statut','select',['Disponible','Réservée','En maintenance'])]}
};
const SEED={
 membres:[{nom:'Yanis B.',dept:DEPTS[0],role:'Membre',statut:'Actif'},{nom:'Sara K.',dept:DEPTS[2],role:'Chef d’unité',statut:'Actif'},{nom:'Adam R.',dept:DEPTS[1],role:'Membre',statut:'Actif'},{nom:'Lina M.',dept:DEPTS[3],role:'Membre',statut:'Inactif'}],
 communication:[{titre:'Réunion technique',type:'Annonce',auteur:'Sara K.',date:'2026-09-22',statut:'Publié'},{titre:'Budget freins validé',type:'Décision',auteur:'Bureau',date:'2026-09-18',statut:'Publié'},{titre:'Compte rendu du 10 septembre',type:'Compte rendu',auteur:'Secrétariat',date:'2026-09-11',statut:'Brouillon'}],
 documents:[{nom:'Plan_chassis.pdf',projet:'Châssis V2',version:'v3',statut:'Validé'},{nom:'Rapport_aero.pdf',projet:'Aérodynamique',version:'v2',statut:'En attente'},{nom:'CAD_suspension.dwg',projet:'Suspension',version:'v1',statut:'Validé'}],
 projets:[{nom:'Châssis V2',resp:'Adam R.',avancement:65,echeance:'2026-11-15',statut:'Urgent'},{nom:'Aileron avant',resp:'Sara K.',avancement:40,echeance:'2026-12-01',statut:'En cours'},{nom:'Faisceau électrique',resp:'Lina M.',avancement:30,echeance:'2027-01-10',statut:'En cours'}],
 achats:[{article:'Disques de frein',fournisseur:'MotoTech',montant:48000,date:'2026-09-20',statut:'En attente'},{article:'Fibre de carbone',fournisseur:'CompoSup',montant:120000,date:'2026-09-05',statut:'Livré'},{article:'Connecteurs étanches',fournisseur:'ElecPlus',montant:9500,date:'2026-09-24',statut:'En cours'}],
 stocks:[{article:'Vis M6 (boîte)',qte:128,seuil:40,lieu:'Étagère A2'},{article:'Roulements 6203',qte:4,seuil:10,lieu:'Étagère B1'},{article:'Câble 1,5 mm² (m)',qte:86,seuil:30,lieu:'Armoire C'}],
 ateliers:[{nom:'Perceuse à colonne',atelier:'Mécanique',resp:'',statut:'Disponible'},{nom:'Fraiseuse CNC',atelier:'Mécanique',resp:'Adam R.',statut:'Réservée'},{nom:'Poste à souder TIG',atelier:'Soudure',resp:'',statut:'Disponible'},{nom:'Imprimante 3D',atelier:'Prototypage',resp:'',statut:'En maintenance'}]
};
const KEY='erp-enp-racing-v2';
let DB;
try{DB=JSON.parse(localStorage.getItem(KEY))}catch(e){}
if(!DB){DB={};for(const k in SEED)DB[k]=SEED[k].map((r,i)=>({id:i+1,...r}))}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(DB))}catch(e){}};
const status=(k,r)=>M[k].status?M[k].status(r):r.statut;
const RED=['Urgent','En attente','Stock bas','Réservée','Brouillon','Obsolète','Inactif'],OK=['Validé','Livré','Actif','Disponible','OK','Terminé','Publié'];
const badge=s=>s?`<span class="badge ${RED.includes(s)?'red':OK.includes(s)?'ok':''}">${s}</span>`:'';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(f,r)=>{const v=r[f.k];
 if(f.k==='statut')return badge(v);
 if(f.k==='avancement')return`<div class="prog"><i><b class="${r.statut==='Urgent'?'hot':''}" style="width:${Math.min(100,+v||0)}%"></b></i>${+v||0}%</div>`;
 if(f.t==='date')return v?new Date(v).toLocaleDateString('fr-FR'):'';
 if(f.k==='montant')return v===''||v==null?'':(+v).toLocaleString('fr-FR')+' DA';
 return esc(v)};
const counts=()=>({
 projets:DB.projets.filter(r=>r.statut!=='Terminé').length,
 achats:DB.achats.filter(r=>r.statut!=='Livré').length,
 stocks:DB.stocks.filter(r=>status('stocks',r)==='Stock bas').length,
 membres:DB.membres.filter(r=>r.statut==='Actif').length});

const nav=document.getElementById('nav'),view=document.getElementById('view'),dlg=document.getElementById('dlg'),form=document.getElementById('form');
const cta=document.getElementById('cta');
const ui={};// état de vue par module : recherche, filtre, tri
function drawNav(active){
 const c=counts(),badges={achats:c.achats,stocks:c.stocks};
 nav.innerHTML=['dashboard',...Object.keys(M)].map(k=>`<button data-k="${k}" ${k===active?'aria-current="page"':''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>${k==='dashboard'?'Dashboard':M[k].label}${badges[k]?`<span class="n">${badges[k]}</span>`:''}</button>`).join('');
}
nav.onclick=e=>{const b=e.target.closest('button');if(b)location.hash=b.dataset.k};

function dashboard(){
 const c=counts();
 const items=[
  ...DB.stocks.filter(r=>status('stocks',r)==='Stock bas').map(r=>['stocks',`${r.article} : ${r.qte} en stock (seuil ${r.seuil})`,'Réapprovisionner']),
  ...DB.achats.filter(r=>r.statut==='En attente').map(r=>['achats',`${r.article} chez ${r.fournisseur || '—'}`,'Demande à valider']),
  ...DB.projets.filter(r=>r.statut==='Urgent').map(r=>['projets',`${r.nom} : ${r.avancement}% (échéance ${new Date(r.echeance).toLocaleDateString('fr-FR')})`,'Projet urgent']),
  ...DB.documents.filter(r=>r.statut==='En attente').map(r=>['documents',`${r.nom} (${r.version})`,'Validation en attente'])];
 return`<div class="stats">
  <button class="stat" data-go="projets"><small>Projets actifs</small><b>${c.projets}</b></button>
  <button class="stat" data-go="achats"><small>Commandes en cours</small><b>${c.achats}</b></button>
  <button class="stat ${c.stocks?'alert':''}" data-go="stocks"><small>Articles en stock bas</small><b>${c.stocks}</b></button>
  <button class="stat" data-go="membres"><small>Membres actifs</small><b>${c.membres}</b></button></div>
  <section class="panel"><h2>À traiter (${items.length})</h2><div class="alerts">${items.length?items.map(i=>`<button data-go="${i[0]}"><span>${esc(i[1])}<br><small>${M[i[0]].label}</small></span>${badge(i[2]==='Réapprovisionner'||i[2]==='Projet urgent'?'Urgent':'En attente')}</button>`).join(''):'<div class="empty">Rien à traiter pour le moment.</div>'}</div></section>`;
}
function list(k){
 const m=M[k],u=ui[k]||(ui[k]={q:'',f:'',s:null,d:1});
 const hasS=!!m.status||m.fields.some(f=>f.k==='statut');
 const opts=m.status?['OK','Stock bas']:(m.fields.find(f=>f.k==='statut')||{}).o||[];
 let rows=DB[k].filter(r=>(!u.q||m.fields.some(f=>String(r[f.k]??'').toLowerCase().includes(u.q.toLowerCase())))&&(!u.f||status(k,r)===u.f));
 if(u.s){const f=u.s;rows=[...rows].sort((a,b)=>{const x=a[f],y=b[f];return(typeof x==='number'||(x!==''&&!isNaN(x)&&!isNaN(y)&&f!=='date'&&f!=='echeance')?(+x)-(+y):String(x??'').localeCompare(String(y??''),'fr'))*u.d})}
 const head=m.fields.map(f=>`<th data-s="${f.k}">${f.l}${u.s===f.k?(u.d>0?' ↑':' ↓'):''}</th>`).join('')+(m.status?'<th>État</th>':'')+'<th class="na"></th>';
 const body=rows.map(r=>`<tr>${m.fields.map(f=>`<td>${fmt(f,r)}</td>`).join('')}${m.status?`<td>${badge(status(k,r))}</td>`:''}<td class="act"><button data-edit="${r.id}">Modifier</button><button class="del" data-del="${r.id}">Supprimer</button></td></tr>`).join('');
 return`<section class="panel"><div class="tools"><input type="search" id="q" placeholder="Rechercher…" value="${esc(u.q)}" aria-label="Rechercher">${hasS?`<select id="f" aria-label="Filtrer par statut"><option value="">Tous les statuts</option>${opts.map(o=>`<option ${u.f===o?'selected':''}>${o}</option>`).join('')}</select>`:''}<span class="count">${rows.length} sur ${DB[k].length}</span></div>
 ${rows.length?`<div class="wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`:'<div class="empty">Aucun résultat. Modifiez la recherche ou ajoutez '+m.one+'.</div>'}</section>`;
}
function openForm(k,id){
 const m=M[k],r=id?DB[k].find(x=>x.id===id):{};
 form.innerHTML=`<h3>${id?'Modifier':'Ajouter'} ${m.one}</h3>`+m.fields.map(f=>`<label>${f.l}${f.t==='select'?`<select name="${f.k}">${f.o.map(o=>`<option ${r[f.k]===o?'selected':''}>${o}</option>`).join('')}</select>`:`<input name="${f.k}" type="${f.t}" value="${esc(r[f.k])}" ${f.req?'required':''} ${f.t==='number'?'min="0"':''}>`}</label>`).join('')+`<div class="foot"><button type="button" class="btn ghost" id="cancel">Annuler</button><button class="btn" value="ok">Enregistrer</button></div>`;
 form.onsubmit=e=>{e.preventDefault();
  const d=Object.fromEntries(new FormData(form));
  m.fields.forEach(f=>{if(f.t==='number'&&d[f.k]!=='')d[f.k]=+d[f.k]});
  if(id)Object.assign(r,d);else DB[k].push({id:Date.now(),...d});
  save();dlg.close();go()};
 form.querySelector('#cancel').onclick=()=>dlg.close();
 dlg.showModal();
}
function go(){
 const k=(M[location.hash.slice(1)]||location.hash==='#dashboard')?location.hash.slice(1):'dashboard';
 const label=k==='dashboard'?'Dashboard':M[k].label;
 document.getElementById('title').textContent=label;document.getElementById('crumb').textContent=label;
 document.title=label+' · ERP ENP Racing';
 cta.style.display=k==='dashboard'?'none':'';
 if(k!=='dashboard')cta.textContent='Ajouter '+M[k].one;
 cta.onclick=()=>openForm(k);
 view.innerHTML=k==='dashboard'?dashboard():list(k);
 drawNav(k);
 view.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>location.hash=b.dataset.go);
 if(k==='dashboard')return;
 const u=ui[k];
 const q=view.querySelector('#q');
 q.oninput=()=>{u.q=q.value;const p=q.selectionStart;go();const n=view.querySelector('#q');n.focus();n.setSelectionRange(p,p)};
 const f=view.querySelector('#f');if(f)f.onchange=()=>{u.f=f.value;go()};
 view.querySelectorAll('th[data-s]').forEach(t=>t.onclick=()=>{u.d=u.s===t.dataset.s?-u.d:1;u.s=t.dataset.s;go()});
 view.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openForm(k,+b.dataset.edit));
 view.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{
  if(!b.classList.contains('sure')){b.classList.add('sure');b.textContent='Confirmer ?';setTimeout(()=>{b.classList.remove('sure');b.textContent='Supprimer'},3000);return}
  DB[k]=DB[k].filter(x=>x.id!==+b.dataset.del);save();go()});
}
document.getElementById('reset').onclick=()=>{try{localStorage.removeItem(KEY)}catch(e){}location.reload()};
addEventListener('hashchange',go);go();
