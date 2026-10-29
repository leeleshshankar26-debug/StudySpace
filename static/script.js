/* All progress and results come from the Flask API. */
const root=document.querySelector('#root'),$=s=>document.querySelector(s);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let csrf='',user=null,data=null,page=pageFromPath(),authMode=document.body.dataset.authMode||'login';
let doc=null,section=0,selectedFile=null,quiz=null,qi=0,result=null;
let timer={mode:'focus',duration:1500,elapsed:0,running:false,token:null,document_id:null,anchor:0},savingTimer=false;
const navItems=['Overview','My Materials','Study','Quizzes'];
function icon(name){const p={Overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z','My Materials':'M6 2h8l4 4v16H6z M14 2v5h5 M9 12h6 M9 16h6',Study:'M12 5v16 M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z',Quizzes:'M4 12l5 5L20 5',ForgetLess:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10','Revision Planner':'M3 5h18v16H3z M3 10h18 M7 2v6 M17 2v6','Study Timer':'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v6h4',Settings:'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',upload:'M12 16V3 M7 8l5-5 5 5 M3 15v6h18v-6',Logout:'M10 3H4v18h6 M8 12h13 M16 7l5 5-5 5'};return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${p[name]||p.Study}"/></svg>`;}
function toast(text){$('#notice').textContent=text;$('#notice').classList.add('visible');clearTimeout(window.noticeTimeout);window.noticeTimeout=setTimeout(()=>$('#notice').classList.remove('visible'),6000);}
async function api(path,method='GET',body){const options={method,headers:{'X-CSRF-Token':csrf}};if(body instanceof FormData)options.body=body;else if(body!==undefined){options.body=JSON.stringify(body);options.headers['Content-Type']='application/json';}const response=await fetch('/api'+path,options),value=await response.json();if(!response.ok){if(response.status===401){timer.running=false;user=null;render();}throw Error(value.error||'Request failed.');}return value;}
async function run(fn,button){if(button?.disabled)return;if(button)button.disabled=true;try{await fn();}catch(e){toast(e.message);}finally{if(button?.isConnected)button.disabled=false;}}
async function refresh(){data=await api('/data');}
const pagePaths = {'Overview':'/dashboard','My Materials':'/materials','Study':'/study','Quizzes':'/quizzes','ForgetLess':'/forgetless','Revision Planner':'/revision','Study Timer':'/timer','Settings':'/settings'};
function pageFromPath() {
  const routes = {'/':'Overview','/dashboard':'Overview','/materials':'My Materials','/study':'Study','/quizzes':'Quizzes','/forgetless':'ForgetLess','/revision':'Revision Planner','/timer':'Study Timer','/settings':'Settings'};
  const requested = new URLSearchParams(location.search).get('next');
  return routes[requested?.split('?')[0]] || routes[location.pathname] || 'Overview';
}
function syncLocation() {
  const path = pagePaths[page];
  if (path && location.pathname !== path) history.pushState({}, '', path);
}
async function boot() {
  try {
    const state = await api('/session');
    csrf = state.csrf;
    user = state.user;
    if (user) {
      await refresh();
      page = pageFromPath();
      const requested = new URLSearchParams(location.search).get('next');
      const documentId = new URLSearchParams(requested?.split('?')[1] || location.search).get('document');
      if (page === 'Study' && data.documents.some(d => String(d.id) === documentId)) {
        await openMaterial(documentId, true, true);
      } else history.replaceState({}, '', pagePaths[page] || '/dashboard');
    }
    render();
  } catch (error) { root.innerHTML = empty('Unable to load StudySpace', error.message); }
}
window.addEventListener('popstate', () => run(async () => {
  page = pageFromPath();
  if (page === 'Study') {
    const id = new URLSearchParams(location.search).get('document');
    if (id && data.documents.some(d => String(d.id) === id)) { await openMaterial(id, true, true); return; }
    doc = null;
  }
  render();
}));
function empty(title,text){return `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;}
function dateText(x){return new Date(x.includes(' ')?x.replace(' ','T')+'Z':x+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});}
function options(value='',all=true){return `<option value="">${all?'All materials':'Choose material'}</option>`+data.documents.map(d=>`<option value="${d.id}" ${String(value)===String(d.id)?'selected':''}>${esc(d.title)}</option>`).join('');}
function heading(title,sub,action=''){return `<header class="pagehead"><div><p class="eyebrow">STUDYSPACE / ${esc(page.toUpperCase())}</p><h1>${esc(title)}</h1><p class="muted">${esc(sub)}</p></div>${action}</header>`;}
function render(){if(!user){auth();return;}root.innerHTML=`<div class="layout"><aside class="sidebar"><a class="brand" href="/">${icon('Study')}<span>StudySpace<small>Learn smarter. Remember longer.</small></span></a><p class="eyebrow navlabel">YOUR WORKSPACE</p><nav>${navItems.map(n=>`<button class="nav ${page===n?'active':''}" data-nav="${n}" ${page===n?'aria-current="page"':''}>${icon(n)}${n}</button>`).join('')}</nav><div class="sidebottom"><p class="profile"><span class="avatar">${esc(user.name[0].toUpperCase())}</span><span>${esc(user.name)}<small>Student workspace</small></span></p><button class="nav" data-action="logout">${icon('Logout')}Logout</button></div></aside><main><header class="topbar"><span>${esc(page)}</span><small>${new Date().toLocaleDateString(undefined,{weekday:'short',month:'long',day:'numeric'})}</small></header><div class="content">${content()}</div></main></div>`;bind();}
function content(){switch(page){case'My Materials':return materials();case'Material':return materialView();case'Study':return study();case'Quizzes':return quizzes();case'Quiz':return quizView();case'ForgetLess':return forgetless();case'Revision Planner':return planner();case'Study Timer':return timerView();case'Settings':return settings();default:return overview();}}
async function navigate(next){if(next==='Study'&&doc){await openMaterial(doc.id,true);return;}page=next;syncLocation();render();}
function materialRows(limit=100){return data.documents.slice(0,limit).map(d=>`<div class="materialrow"><span class="filetype">${esc(d.kind.toUpperCase())}</span><div class="grow"><button class="textbutton titlebutton" data-material="${d.id}">${esc(d.title)}</button><small>${dateText(d.created)} · ${d.completed} of ${d.sections} sections completed</small><div class="progress"><span style="width:${d.sections?100*d.completed/d.sections:0}%"></span></div></div><button class="secondary" data-study="${d.id}">Study</button>${limit===100?`<button class="textbutton danger" data-delete-doc="${d.id}">Delete</button>`:''}</div>`).join('')||empty('Your library is ready for its first notes','Upload a PDF, DOCX or TXT file. Read your source in Study or practise a quiz.');}
function taskRows(items){return items.map(t=>`<div class="listrow"><div class="grow"><strong>${esc(t.title)}</strong><small>${esc(t.due)} · ${t.completed?'Completed':t.due<data.today?'Overdue':t.due===data.today?'Due today':'Upcoming'}</small></div>${t.document_id?`<button class="textbutton" data-study="${t.document_id}">Study</button>`:''}<button class="secondary" data-complete-topic="${t.id}">${t.completed?'Reopen':'Complete'}</button></div>`).join('')||empty('Nothing due today','Plan a revision task to give your next study session a direction.');}
function graph(){const max=Math.max(1500,...data.week.map(d=>d.seconds));return `<div class="activitygraph" role="img" aria-label="Completed focus time: ${data.week.map(d=>dateText(d.day)+': '+d.seconds/60+' minutes').join('; ')}">${data.week.map(d=>`<div class="barcolumn"><small>${Math.floor(d.seconds/60)}m</small><div class="bartrack"><span style="height:${100*d.seconds/max}%"></span></div><small>${dateText(d.day)}</small></div>`).join('')}</div><p class="caption">Completed focus sessions over the last seven days. Breaks and unfinished timers excluded.</p>`;}
function overview(){const total=data.documents.reduce((s,d)=>s+d.sections,0),done=data.documents.reduce((s,d)=>s+d.completed,0),progress=total?Math.round(done/total*100):0,recent=continueDocument();return heading(`Welcome back, ${user.name.split(' ')[0]}.`,'A little focus today. A clearer understanding tomorrow.',`<button data-nav="My Materials">${icon('upload')}Upload Notes</button>`)+`<section class="introstrip"><div><p class="eyebrow">YOUR NEXT CHAPTER</p><h2>Make your notes work for you.</h2><p>Upload once. Recall the ideas. Return to what needs practice.</p></div><button class="secondary" ${recent?`data-study="${recent.id}"`:'data-nav="My Materials"'}>${recent?'Continue learning':'Upload your first notes'} →</button></section><section class="stats">${[[data.documents.length,'Study materials'],[done,'Sections completed'],[data.attempts.length,'Quiz attempts'],[Math.floor(data.study_seconds/60)+'m','Completed focus time']].map(([n,t])=>`<div><span class="statvalue">${n}</span><span class="muted">${t}</span></div>`).join('')}</section><div class="columns"><section class="section"><div class="sectionhead"><h2>Recent materials</h2><button class="textbutton" data-nav="My Materials">View library →</button></div>${materialRows(3)}</section><section class="section"><div class="sectionhead"><h2>Learning progress</h2><span class="badge">${progress}%</span></div><p class="bigvalue">${done}<span> / ${total}</span></p><p class="muted">Saved lesson sections completed</p><div class="progress"><span style="width:${progress}%"></span></div><h3 class="spaced">Continue learning</h3>${recent?`<p>${esc(recent.title)}</p><button class="secondary" data-study="${recent.id}">Continue reading →</button>`:empty(total?'All sections completed':'A fresh start',total?'Revisit your notes or test your recall.':'Upload notes to start your learning progress.')}</section></div><div class="columns"><section class="section"><h2>Recent quiz performance</h2>${historyRows(3)}</section><section class="section"><h2>Recent activity</h2>${data.activity.slice(0,5).map(a=>`<div class="listrow"><span class="grow">${esc(a.message)}</span><small>${dateText(a.created)}</small></div>`).join('')||empty('Your activity will appear here','Begin with an upload or a focused session.')}</section></div>`;}
function materials(){return heading('Your notes, all in one place.','PDF, Word or plain text. Start with what you already have.')+`<section class="uploadsection"><form id="upload-form"><div class="drop" id="drop">${icon('upload')}<h2>Drop your study material here</h2><p class="muted">PDF, DOCX, TXT · Maximum 10 MB</p><input class="sr-only" type="file" id="file" accept=".pdf,.docx,.txt"><label class="button secondary" for="file">Browse files</label></div><div id="selected-file"></div><button id="upload-button">Upload & extract notes</button></form></section><section class="section"><h2>My materials <span class="badge">${data.documents.length}</span></h2>${materialRows()}</section>`;}
function continueDocument() {
  return [...data.documents].filter(d=>d.last_read).sort((a,b)=>b.last_read.localeCompare(a.last_read))[0]
    || data.documents.find(d=>d.completed<d.sections) || data.documents[0];
}
async function openMaterial(id, learning=false, replaceHistory=false) {
  const material = await api('/documents/'+id);
  doc = material;
  section = Math.max(0, Math.min(doc.sections.length-1, doc.resume_position || 0));
  if (learning) {
    if (doc.sections.length) await savePosition(section);
    page='Study';
    const address='/study?document='+doc.id;
    if(replaceHistory) history.replaceState({},'',address);
    else if(location.pathname+location.search!==address) history.pushState({},'',address);
  } else page='Material';
  render();
}
async function savePosition(index) {
  if (!doc?.sections[index]) return;
  await api('/documents/'+doc.id+'/position', 'POST', {section_id:doc.sections[index].id});
  doc.resume_position=index;
  const saved=data.documents.find(d=>d.id===doc.id);
  if (saved) { saved.reading_position=index; saved.last_read=new Date().toISOString(); }
}
async function goToSection(index) {
  if (!Number.isInteger(index) || index<0 || index>=doc.sections.length) return;
  await savePosition(index);
  section=index;
  render();
  $('#reading-heading')?.focus({preventScroll:true});
  $('#reader-page')?.scrollIntoView({block:'start',behavior:'auto'});
}
function materialView() {
  return heading(doc.title,'Your source is ready. Choose where to begin.',
    '<button class="secondary" data-nav="My Materials">Back to library</button>') +
    `<section class="sourceintro"><span class="badge">${doc.text.split(/\s+/).length} extracted words</span>
      <p>Read the original extracted notes or practise questions based on this source.</p>
      <div class="actions"><button data-study="${doc.id}">Start Learning</button><button class="secondary" data-nav="Quizzes">Generate Quiz</button><button class="textbutton" data-action="view-notes">View Extracted Notes</button></div>
      <p class="caption">${doc.questions} usable quiz questions available.</p>
    </section><section class="section"><h2>Extracted notes</h2><details id="notes-details"><summary>Read original extracted text</summary><pre class="notes">${esc(doc.text)}</pre></details></section>`;
}
function sectionLabel(item,index) { return item.title || 'Reading section '+(index+1); }
function readingConcepts(item) {
  const passage=item.text.replace(/\s+/g,' ');
  return (doc.concepts||[]).filter(c=>passage.includes(c.source.replace(/\s+/g,' ')));
}
function highlightTerms(text, concepts) {
  const terms=[...new Set(concepts.map(c=>c.term))].filter(Boolean).sort((a,b)=>b.length-a.length);
  if(!terms.length) return esc(text);
  const escaped=terms.map(term=>term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const pattern=new RegExp('('+escaped.join('|')+')','gi');
  return text.split(pattern).map((part,index)=>index%2?'<mark class="keyterm">'+esc(part)+'</mark>':esc(part)).join('');
}
function readingPassage(item) {
  const concepts=readingConcepts(item),blocks=item.blocks||[];
  if(!blocks.length) return '<p>'+highlightTerms(item.text,concepts)+'</p>';
  let html='',list=null;
  for(const [index,block] of blocks.entries()) {
    if(index===0 && block.kind==='heading' && block.text===item.title) continue;
    const type=block.kind==='bullet'?'ul':block.kind==='number'?'ol':null;
    if(list && list!==type) { html+='</'+list+'>'; list=null; }
    if(type) {
      if(!list) { html+='<'+type+'>'; list=type; }
      html+='<li'+(type==='ol'?' value="'+Number(block.number)+'"':'')+'>'+highlightTerms(block.text,concepts)+'</li>';
    } else html+=(block.kind==='heading'?'<h3>':'<p>')+highlightTerms(block.text,concepts)+(block.kind==='heading'?'</h3>':'</p>');
  }
  if(list) html+='</'+list+'>';
  return html;
}
function study() {
  if(!doc) {
    const resume=continueDocument();
    return heading('Your reading desk','Choose your notes and continue with the original extracted text.')+
      (resume?`<div class="reading-resume"><div><small>CONTINUE READING</small><h2>${esc(resume.title)}</h2><p class="muted">${resume.reading_position!=null?'Last opened: reading section '+(resume.reading_position+1):'Begin with your first unread section.'}</p></div><button data-study="${resume.id}">Continue reading</button></div>`:'')+
      `<section class="section">${materialRows()}</section>`;
  }
  if(!doc.sections.length) return heading(doc.title,'No readable sections are available.')+empty('This material has no readable text','Choose another document with selectable text, or upload a text-based PDF, DOCX or TXT file.');
  const item=doc.sections[section],completed=doc.sections.filter(s=>s.completed).length,concepts=readingConcepts(item);
  const position=Math.round((section+1)/doc.sections.length*100);
  return `<header class="reader-header"><p class="eyebrow">YOUR READING DESK</p><h1>${esc(doc.title)}</h1><p class="muted">Original extracted text · ${doc.sections.length} reading section${doc.sections.length===1?'':'s'}. Section numbers do not refer to PDF pages.</p></header>
    <div class="reader-layout">
      <aside class="reader-contents"><details open><summary>Contents <small>${doc.sections.length} sections</small></summary><nav aria-label="Reading sections">${doc.sections.map((entry,index)=>`<button data-reading-section="${index}" class="contents-link ${index===section?'active':''}" ${index===section?'aria-current="location"':''}><span class="contents-number">${String(index+1).padStart(2,'0')}</span><span>${esc(sectionLabel(entry,index))}<small>${entry.completed?'Completed':'Not completed'}</small></span></button>`).join('')}</nav></details><p class="caption">${completed} of ${doc.sections.length} sections marked complete.</p></aside>
      <div class="reader-column">
        <div class="reader-toolbar"><span>Reading section ${section+1} of ${doc.sections.length}</span><span class="badge">${item.completed?'Completed':'Reading'}</span></div>
        <div class="progress reader-progress" role="progressbar" aria-label="Current position in extracted text" aria-valuenow="${section+1}" aria-valuemin="0" aria-valuemax="${doc.sections.length}"><span style="width:${position}%"></span></div>
        <article class="reader-page" id="reader-page"><p class="eyebrow">SECTION ${String(section+1).padStart(2,'0')} / EXTRACTED TEXT</p><h2 id="reading-heading" tabindex="-1">${esc(sectionLabel(item,section))}</h2><div class="textbook-passage">${readingPassage(item)}</div></article>
        <div class="reader-pagination"><button class="secondary" data-action="prev-section" ${section===0?'disabled':''}>← Previous</button><button data-action="complete-section" ${item.completed?'disabled':''}>${item.completed?'Section completed':'Mark section complete'}</button><button class="secondary" data-action="next-section" ${section===doc.sections.length-1?'disabled':''}>Next →</button></div>
        <p class="caption reader-position">Reading position: section ${section+1} of ${doc.sections.length} (${position}%). Completion: ${completed} of ${doc.sections.length}. Your last opened section is saved automatically.</p>
        ${concepts.length?`<details class="reader-concepts"><summary>Key concepts in this section <span class="badge">${concepts.length}</span></summary><dl>${concepts.map(c=>`<dt>${esc(c.term)}</dt><dd>${esc(c.answer)}</dd>`).join('')}</dl><p class="caption">Definitions detected in this source passage. No extra explanations have been added.</p></details>`:'<p class="caption">No reliable definition patterns were identified in this section.</p>'}
        <footer class="reader-learning"><span>Practise what you just read</span><div class="actions"><button class="textbutton" data-action="reader-quiz">Generate quiz from this document</button></div></footer>
      </div>
    </div>`;
}
function historyRows(limit=100){return data.attempts.slice(0,limit).map(a=>`<div class="listrow"><div class="grow"><strong>${esc(a.title)}</strong><small>${dateText(a.created)} · ${a.total} questions</small></div><span class="badge">${a.correct}/${a.total} · ${Math.round(a.correct/a.total*100)}%</span><button class="textbutton" data-quiz-doc="${a.document_id}">Practise</button></div>`).join('')||empty('No quiz attempts yet','Choose uploaded material to test your recall.');}
function quizzes(){return heading('Recall. Reflect. Repeat.','A quiz is a check-in with your understanding.')+`<section class="section narrow"><h2>Generate a source-based quiz</h2>${data.documents.length?`<form id="quiz-form"><label for="quiz-doc">Source material</label><select id="quiz-doc" required>${options(doc?.id,false)}</select><label for="quiz-length">Quiz length</label><select id="quiz-length"><option value="5">5 questions</option><option value="10">10 questions</option><option value="15">15 questions</option></select><p class="muted">Definitions and terms from the source become questions and options. At least four suitable concepts are needed. Your quiz may be shorter than requested.</p><button>Generate & start quiz</button></form>`:empty('Upload your notes first','The source document provides the questions and explanations.')}</section><section class="section"><h2>Quiz history</h2>${historyRows()}</section>`;}
function quizView(){if(result)return heading('A clearer picture of what you know.','Review your answers, then revisit the source.')+`<section class="section narrow"><p class="eyebrow">QUIZ COMPLETE</p><h2>${result.correct} / ${result.total} correct · ${Math.round(result.correct/result.total*100)}%</h2><p>${result.results.filter(r=>!r.correct).length} question(s) to revisit. Your confidence ratings are saved with these results.</p>${result.results.map(r=>`<article class="answerresult ${r.correct?'':'incorrect'}"><span class="badge">${r.correct?'Correct':'Revisit'} · ${esc(r.confidence)} confidence</span><h3>${esc(r.prompt)}</h3><p>Your answer: ${esc(r.selected)}<br>Correct answer: <strong>${esc(r.answer)}</strong></p><blockquote>${esc(r.explanation)}</blockquote></article>`).join('')}<div class="actions"><button data-nav="Quizzes">Practise another quiz</button></div></section>`;const q=quiz.questions[qi];return heading('Give yourself a moment to think.',`Question ${qi+1} of ${quiz.questions.length}`)+`<section class="section narrow"><div class="progress"><span style="width:${100*(qi+1)/quiz.questions.length}%"></span></div><h2 class="questionprompt">${esc(q.prompt)}</h2>${q.options.map((o,i)=>`<button class="option ${q.selected===o?'selected':''}" data-option="${i}" aria-pressed="${q.selected===o}"><span class="optionletter">${'ABCD'[i]}</span><span>${esc(o)}</span></button>`).join('')}<fieldset><legend>How confident are you?</legend><p class="caption">Choose before revealing correctness at the end.</p><div class="actions">${['Low','Medium','High'].map(c=>`<button class="secondary ${q.confidence===c?'chosen':''}" data-confidence="${c}" aria-pressed="${q.confidence===c}">${c}</button>`).join('')}</div></fieldset><p class="muted">${quiz.questions.filter(q=>q.selected&&q.confidence).length}/${quiz.questions.length} answered with confidence</p><div class="sectionhead"><button class="secondary" data-action="prev-question" ${qi===0?'disabled':''}>← Previous</button>${qi<quiz.questions.length-1?'<button data-action="next-question">Next →</button>':'<button data-action="submit-quiz">Submit quiz</button>'}</div></section>`;}
function forgetless(){return heading('Find what you forget.','Fix what you learn. Let real answers and reviews guide your next step.')+`<section class="section"><h2>Your learning picture</h2><p class="muted">A high-confidence mistake takes precedence. Otherwise, the latest quiz score for each document sets its status. Changes compare the same document and question count; question samples may differ.</p>${data.insights.map(i=>`<div class="insightrow"><div class="grow"><strong>${esc(i.title)}</strong><small>${i.score===null?'Complete a quiz to gather evidence.':`Latest score ${i.score}%${i.change===null?' · No comparable earlier attempt':` · ${i.change>0?'+':''}${i.change} percentage points vs previous ${i.total}-question attempt`}`}</small></div><span class="badge ${['Learning Gap','Needs Practice'].includes(i.status)?'attention':''}">${i.status}</span><button class="textbutton" data-quiz-doc="${i.document_id}">Practise quiz →</button></div>`).join('')||empty('Not enough data yet','Upload material and complete a quiz.')}<p class="caption">Learning Gap → Needs Practice (&lt;60%) → Developing (60–79%) → Strong (≥80%). Historical gaps remain visible.</p></section><div class="columns"><section class="section"><h2>Confidence worth checking</h2>${data.gaps.map(g=>`<article class="answerresult incorrect"><span class="badge attention">High confidence · Incorrect</span><h3>${esc(g.topic)}</h3><blockquote>${esc(g.explanation)}</blockquote><div class="actions"><button class="textbutton" data-study="${g.document_id}">Revisit source →</button></div></article>`).join('')||empty('No high-confidence mistakes recorded',data.attempts.length?'Keep checking confidence and recall together.':'Complete a quiz to see confidence insights.')}</section><section class="section"><h2>Concepts marked for practice</h2>${data.practice.map(c=>`<div class="listrow"><div class="grow"><strong>${esc(c.question)}</strong><small>${c.practice_count} Need Practice reviews</small></div></div>`).join('')||empty('No practice marks yet','Mark difficult cards Need Practice to keep track of them.')}</section></div>`;}
function planner(){const needs=data.insights.filter(i=>['Learning Gap','Needs Practice'].includes(i.status));return heading('Give your next revisit a date.','Keep deadlines visible and leave room for difficult concepts.','<button data-action="add-topic">Add revision task</button>')+`<section class="section"><h2>Revision tasks</h2>${data.topics.map(t=>`<div class="listrow"><div class="grow"><strong>${esc(t.title)}</strong><small>${esc(t.due)} · ${t.completed?'Completed':t.due<data.today?'Overdue':t.due===data.today?'Due today':'Upcoming'}${t.document_id?' · '+esc(data.documents.find(d=>d.id===t.document_id)?.title||''):''}</small></div><div class="actions">${t.document_id?`<button class="textbutton" data-study="${t.document_id}">Study</button>`:''}<button class="secondary" data-complete-topic="${t.id}">${t.completed?'Reopen':'Complete'}</button><button class="textbutton" data-edit-topic="${t.id}">Edit</button><button class="textbutton danger" data-delete-topic="${t.id}">Delete</button></div></div>`).join('')||empty('A plan starts with one topic','Choose a date and optionally link a source document.')}</section><section class="section"><h2>A suggested next step</h2><p class="muted">Overdue tasks first, then the nearest deadline. Revisit learning gaps today. These simple planning rules do not predict memory.</p>${data.topics.filter(t=>!t.completed).slice(0,3).map(t=>`<div class="listrow"><span class="grow">${esc(t.title)} · ${esc(t.due)}</span><button class="textbutton" data-edit-topic="${t.id}">Review task →</button></div>`).join('')}${needs.map(i=>`<div class="listrow"><span class="grow">${esc(i.title)} · ${i.status}</span><button class="textbutton" data-plan-doc="${i.document_id}">Schedule for today →</button></div>`).join('')}${!needs.length&&!data.topics.some(t=>!t.completed)?empty('No suggestions yet','Add a deadline or complete a quiz to make the planner useful.'):''}</section>`;}
function elapsed(){return Math.min(timer.duration,timer.elapsed+(timer.running?(Date.now()-timer.anchor)/1000:0));}
function countdown(){const remaining=Math.max(0,Math.ceil(timer.duration-elapsed()));return `${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;}
function timerView(){return heading('One task. A little focus.','Completed focus sessions build your study history.')+`<section class="timersection"><div class="tabs">${[['focus','Focus · 25 min'],['short','Short break · 5 min'],['long','Long break · 15 min']].map(([m,label])=>`<button data-timer-mode="${m}" class="${timer.mode===m?'active':''}">${label}</button>`).join('')}</div><label for="timer-doc">Study material (optional)</label><select id="timer-doc" ${timer.token?'disabled':''}><option value="">No linked material</option>${data.documents.map(d=>`<option value="${d.id}" ${timer.document_id===d.id?'selected':''}>${esc(d.title)}</option>`).join('')}</select><div class="clock" id="clock" role="timer" aria-label="Remaining time">${countdown()}</div><p class="muted">${timer.running?'Session in progress':timer.token?'Paused':'Ready when you are'}</p><div class="actions center"><button data-action="timer-toggle">${timer.running?'Pause':timer.token?'Resume':'Start session'}</button><button class="secondary" data-action="timer-reset">Reset</button></div><p class="caption">Only a full countdown is saved. Reset or reload to discard incomplete time. Breaks do not count as focus time.</p></section><section class="section"><h2>Completed sessions</h2>${data.sessions.filter(s=>s.mode!=='legacy').map(s=>`<div class="listrow"><span class="grow">${s.mode==='focus'?'Focus':s.mode==='short'?'Short break':'Long break'}${s.document_title?' · '+esc(s.document_title):''}</span><small>${s.finished?dateText(s.finished):''}</small><strong>${s.seconds/60} min</strong></div>`).join('')||empty('Your first focus session awaits','Finish a countdown to save a session here.')}</section>`;}
function settings(){return heading('Your workspace, your details.','Keep your student profile up to date.')+`<section class="section narrow"><form id="settings-form"><label for="settings-name">Name</label><input id="settings-name" value="${esc(user.name)}" maxlength="80" required><label>Email</label><p>${esc(user.email)}</p><button>Save profile</button></form><hr><h2>About your data</h2><p class="muted">Your notes, reading progress, and quiz history are saved in this local installation. Deleting material removes its linked learning records.</p><button class="secondary" data-action="logout">Logout</button></section>`;}
function auth(){root.innerHTML=`<div class="auth"><section class="authstory"><a class="brand" href="/login">${icon('Study')}StudySpace</a><p class="eyebrow">A SPACE FOR YOUR NEXT CHAPTER</p><h1>Learn smarter.<br>Remember longer.</h1><p>Turn notes into knowledge that stays.<br>One concept, one question, one focused session at a time.</p><div class="authsteps"><span>01 &nbsp; Bring your notes</span><span>02 &nbsp; Practise your recall</span><span>03 &nbsp; Return to what matters</span></div></section><section class="authform"><form id="auth-form"><p class="eyebrow">YOUR LEARNING WORKSPACE</p><h1>${authMode==='register'?'Start your next chapter.':'Welcome back.'}</h1><p class="muted">${authMode==='register'?'Create your student account.':'Sign in to continue your learning.'}</p><div id="auth-error" role="alert"></div>${authMode==='register'?'<label for="name">Your name</label><input id="name" name="name" autocomplete="name" maxlength="80" required>':''}<label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required><label for="password">Password</label><input id="password" name="password" type="password" minlength="${authMode==='register'?8:1}" maxlength="128" autocomplete="${authMode==='register'?'new-password':'current-password'}" required>${authMode==='register'?'<small>Use at least 8 characters.</small>':''}<button class="full">${authMode==='register'?'Create account':'Sign in'} →</button><p class="authlink">${authMode==='register'?'Already have an account? <a href="/login">Sign in</a>':'New to StudySpace? <a href="/register">Create an account</a>'}</p></form></section></div>`;$('#auth-form').onsubmit=e=>{e.preventDefault();run(async()=>{try{await api('/'+authMode,'POST',Object.fromEntries(new FormData(e.target)));if(authMode==='register'){authMode='login';history.replaceState({},'','/login');auth();toast('Account created. Sign in to begin.');}else await boot();}catch(err){$('#auth-error').textContent=err.message;$('#auth-error').className='formerror';}},e.target.querySelector('button'));};}
function edit(title,fields,save){const dialog=$('#editor');$('#editor-title').textContent=title;$('#editor-fields').innerHTML=fields.map(f=>`<label for="edit-${f.name}">${esc(f.label)}</label>${f.type==='textarea'?`<textarea id="edit-${f.name}" name="${f.name}" maxlength="${f.max||5000}" required>${esc(f.value||'')}</textarea>`:f.type==='select'?`<select id="edit-${f.name}" name="${f.name}">${options(f.value).replace('All materials','No linked material')}</select>`:`<input id="edit-${f.name}" name="${f.name}" type="${f.type||'text'}" value="${esc(f.value||'')}" maxlength="${f.max||200}" required>`}`).join('');$('#cancel-edit').onclick=()=>dialog.close();$('#editor-form').onsubmit=e=>{e.preventDefault();run(async()=>{await save(Object.fromEntries(new FormData(e.target)));dialog.close();await refresh();render();toast('Saved.');},e.target.querySelector('button:last-child'));};dialog.showModal();}
function editTopic(t={}){edit(t.id?'Edit revision task':'Plan revision',[{name:'title',label:'Topic',value:t.title},{name:'due',label:'Due date',type:'date',value:t.due||data.today},{name:'document_id',label:'Source material (optional)',type:'select',value:t.document_id}],v=>api('/topics'+(t.id?'/'+t.id:''),t.id?'PUT':'POST',{...v,document_id:v.document_id?+v.document_id:null}));}
function showFile(){const n=$('#selected-file');if(!n)return;n.innerHTML=selectedFile?`<div class="selectedfile"><span>${esc(selectedFile.name)} · ${(selectedFile.size/1048576).toFixed(2)} MB</span><button type="button" class="textbutton" id="remove-file">Remove</button></div>`:'';if($('#remove-file'))$('#remove-file').onclick=()=>{selectedFile=null;$('#file').value='';showFile();};}
function clicks(selector,handler){document.querySelectorAll(selector).forEach(b=>b.onclick=()=>run(()=>handler(b),b));}
function bind(){
clicks('[data-reading-section]',b=>goToSection(+b.dataset.readingSection));
clicks('[data-nav]',b=>navigate(b.dataset.nav));clicks('[data-action]',b=>action(b.dataset.action));clicks('[data-material]',b=>openMaterial(b.dataset.material));clicks('[data-study]',b=>openMaterial(b.dataset.study,true));
clicks('[data-delete-doc]',async b=>{if(confirm('Delete this material, linked cards and reviews, map, lessons, and quiz history?')){await api('/documents/'+b.dataset.deleteDoc,'DELETE');if(doc?.id===+b.dataset.deleteDoc)doc=null;await refresh();render();}});
clicks('[data-option]',b=>{quiz.questions[qi].selected=quiz.questions[qi].options[+b.dataset.option];render();});clicks('[data-confidence]',b=>{quiz.questions[qi].confidence=b.dataset.confidence;render();});clicks('[data-quiz-doc]',async b=>{doc=await api('/documents/'+b.dataset.quizDoc);page='Quizzes';render();});
clicks('[data-edit-topic]',b=>editTopic(data.topics.find(t=>t.id===+b.dataset.editTopic)));clicks('[data-delete-topic]',async b=>{if(confirm('Delete this task?')){await api('/topics/'+b.dataset.deleteTopic,'DELETE');await refresh();render();}});clicks('[data-complete-topic]',async b=>{const t=data.topics.find(t=>t.id===+b.dataset.completeTopic);await api('/topics/'+t.id,'PUT',{completed:!t.completed});await refresh();render();});clicks('[data-plan-doc]',b=>editTopic({title:'Revise '+data.documents.find(d=>d.id===+b.dataset.planDoc).title,document_id:+b.dataset.planDoc,due:data.today}));
clicks('[data-timer-mode]',b=>{if(timer.token&&!confirm('Discard incomplete session and change mode?'))return;timer={mode:b.dataset.timerMode,duration:{focus:1500,short:300,long:900}[b.dataset.timerMode],elapsed:0,running:false,token:null,document_id:timer.document_id,anchor:0};render();});
if($('#timer-doc'))$('#timer-doc').onchange=e=>timer.document_id=e.target.value?+e.target.value:null;
if($('#settings-form'))$('#settings-form').onsubmit=e=>{e.preventDefault();run(async()=>{await api('/settings','POST',{name:$('#settings-name').value});user=(await api('/session')).user;render();toast('Profile updated.');},e.target.querySelector('button'));};
if($('#quiz-form'))$('#quiz-form').onsubmit=e=>{e.preventDefault();run(async()=>{const id=+$('#quiz-doc').value;if(!id)throw Error('Choose a source material.');quiz=await api('/quizzes','POST',{document_id:id,length:+$('#quiz-length').value});quiz.document_id=id;qi=0;result=null;page='Quiz';render();},e.target.querySelector('button'));};
if($('#upload-form')){showFile();$('#file').onchange=e=>{selectedFile=e.target.files[0]||null;showFile();};const drop=$('#drop');drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag');};drop.ondragleave=()=>drop.classList.remove('drag');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag');selectedFile=e.dataTransfer.files[0]||null;showFile();};$('#upload-form').onsubmit=e=>{e.preventDefault();run(async()=>{if(!selectedFile)throw Error('Choose a file first.');if(selectedFile.size>10485760)throw Error('The maximum file size is 10 MB.');const b=$('#upload-button');b.textContent='Extracting your notes…';try{const fd=new FormData();fd.append('file',selectedFile);const r=await api('/documents','POST',fd);selectedFile=null;await refresh();await openMaterial(r.id);toast('Notes extracted. Choose your next activity.');}finally{if(b.isConnected)b.textContent='Upload & extract notes';}},e.target.querySelector('#upload-button'));};}}
async function action(name) {
  switch(name) {
    case 'logout': await api('/logout','POST'); timer.running=false; location.assign('/login'); break;
    case 'view-notes': $('#notes-details').open=true; $('#notes-details').scrollIntoView({behavior:'smooth'}); break;
    case 'complete-section':
      await api('/sections/'+doc.sections[section].id,'POST',{});
      doc.sections[section].completed=1; await refresh(); render(); break;
    case 'prev-section': await goToSection(section-1); break;
    case 'next-section': await goToSection(section+1); break;
    case 'reader-quiz': await navigate('Quizzes'); break;
    case 'prev-question': qi--; render(); break;
    case 'next-question': qi++; render(); break;
    case 'submit-quiz':
      result=await api('/quizzes/'+quiz.id+'/submit','POST',{answers:quiz.questions.map(q=>({id:q.id,selected:q.selected,confidence:q.confidence}))});
      await refresh(); render(); break;
    case 'add-topic': editTopic(); break;
    case 'timer-toggle':
      if(!timer.token) {
        const started=await api('/timer/start','POST',{mode:timer.mode,document_id:timer.document_id});
        timer.token=started.token; timer.duration=started.duration; timer.elapsed=0; timer.anchor=Date.now(); timer.running=true;
      } else {
        const state=await api('/timer/control','POST',{token:timer.token,action:timer.running?'pause':'resume'});
        timer.elapsed=state.elapsed; timer.running=state.running; timer.anchor=Date.now();
      }
      render(); break;
    case 'timer-reset':
      if(timer.token&&!confirm('Discard this incomplete session?')) break;
      timer.running=false; timer.elapsed=0; timer.token=null; render(); break;
  }
}
setInterval(()=>{if(!timer.running)return;if($('#clock'))$('#clock').textContent=countdown();if(elapsed()>=timer.duration&&!savingTimer){savingTimer=true;run(async()=>{await api('/timer/finish','POST',{token:timer.token});timer.running=false;timer.token=null;timer.elapsed=timer.duration;await refresh();if(['Study Timer','Overview'].includes(page))render();toast('Session completed and saved.');}).finally(()=>savingTimer=false);}},250);
boot();
