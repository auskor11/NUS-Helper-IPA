/* Tasks tab: tasks grouped by when they're due, one-tap complete, bulk delete.
 * Assessments you do yourself (online quizzes, assignments) appear here too
 * (assessmentTasks in shared.js); ticking one marks the assessment done. */

function dueLabel(t){
  const d=taskDateTime(t);
  const day=relativeDay(d);
  const due=t.dueTime?`${day}, ${inputTimeToLabel(t.dueTime)}`:day;
  if(t.assessment&&t.opens&&!t.done){
    const now=new Date();
    if(t.opens>now) return `Opens ${relativeDay(t.opens)}, ${clockTime(t.opens)}`;
    if(taskDateTime(t)>now) return `Open now · due ${due}`;
  }
  return due;
}

const notOpenYet=t=>t.assessment&&!t.done&&t.opens&&t.opens>new Date();

function taskRowHTML(t,{selecting=false,selected=false}={}){
  const over=isOverdue(t);
  return `<div class="task-row ${t.done?"done":""} ${over?"overdue":""} ${notOpenYet(t)?"not-open":""}">
    ${selecting
      ?`<button class="select-box ${selected?"on":""}" data-select-task="${esc(t.id)}" aria-label="Select ${esc(t.title)}"></button>`
      :`<button class="check ${t.done?"on":""}" data-toggle-task="${esc(t.id)}" aria-label="${t.done?"Mark not done":"Mark done"}: ${esc(t.title)}"></button>`}
    <div class="task-main" data-edit-task="${esc(t.id)}">
      <b>${esc(t.title)}${t.assessment&&weightValue(t.weight)!=null?` <span class="assess-weight">${esc(weightLabel(t.weight))}</span>`:""}</b>
      <small>${t.module?`<span class="mod-tag">${esc(t.module)}</span>`:""}<span class="${over?"due-over":""}">${over?"Overdue · ":""}${esc(dueLabel(t))}</span></small>
    </div>
  </div>`;
}

// Wire up check/edit buttons rendered by taskRowHTML inside a container.
function bindTaskRows(container){
  $$("[data-toggle-task]",container).forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    const t=findTaskItem(b.dataset.toggleTask);
    if(!t) return;
    if(t.assessment){ toggleAssessmentDone(t.code,t.index); return; }
    t.done=!t.done;
    b.classList.toggle("on",t.done);
    save();
    toast(t.done?"Done ✓":"Marked not done");
  });
  $$("[data-edit-task]",container).forEach(b=>b.onclick=()=>{
    const t=findTaskItem(b.dataset.editTask);
    if(t?.assessment) openAssessmentSheet(t.code,t.index);
    else if(t) openTaskForm(t);
  });
}

function openTaskForm(task=null,{date=""}={}){
  const opts=state.modules.map(m=>`<option value="${esc(m.code)}" ${task?.module===m.code?"selected":""}>${esc(m.code)}</option>`).join("");
  const due=task?.dueDate||date||isoDate(addDays(new Date(),1));
  openModal(`<h2>${task?"Edit task":"New task"}</h2>
    <form class="form" id="taskForm">
      <input class="input big" name="title" value="${esc(task?.title||"")}" placeholder="What needs doing?" required ${task?"":"autofocus"}>
      <div class="quick-dates">
        ${[["Today",0],["Tomorrow",1],["In 3 days",3],["Next week",7]].map(([l,n])=>`<button type="button" class="chip" data-days="${n}">${l}</button>`).join("")}
      </div>
      <div class="two">
        <label>Due date<input class="input" type="date" name="dueDate" value="${esc(due)}" required></label>
        <label><span>Time <span class="optional">optional</span></span><input class="input" type="time" name="dueTime" value="${esc(task?.dueTime||"")}"></label>
      </div>
      ${opts?`<label>Module<select class="input" name="module"><option value="">None</option>${opts}</select></label>`:`<input type="hidden" name="module" value="">`}
      <button class="btn primary full">${task?"Save":"Add task"}</button>
      ${task?`<div class="two">
        <button type="button" class="btn secondary" id="taskToggle">${task.done?"Mark not done":"Mark done"}</button>
        <button type="button" class="btn danger-soft" id="taskDelete">Delete</button>
      </div>`:""}
    </form>`);

  const form=$("#taskForm");
  $$(".chip[data-days]",form).forEach(c=>c.onclick=()=>{ form.dueDate.value=isoDate(addDays(new Date(),+c.dataset.days)); });
  form.onsubmit=e=>{
    e.preventDefault();
    const f=new FormData(form);
    const data={title:String(f.get("title")).trim(),module:String(f.get("module")||""),dueDate:String(f.get("dueDate")),dueTime:String(f.get("dueTime")||"")};
    if(task) Object.assign(task,data);
    else state.tasks.push({id:uid(),done:false,...data});
    closeModal(); save(); toast(task?"Task updated":"Task added");
  };
  $("#taskToggle")?.addEventListener("click",()=>{ task.done=!task.done; closeModal(); save(); });
  $("#taskDelete")?.addEventListener("click",async()=>{
    if(!await confirmSheet(`Delete “${task.title}”?`)) return;
    state.tasks=state.tasks.filter(t=>t.id!==task.id);
    save({immediate:true}); toast("Task deleted");
  });
}

views.tasks=(()=>{
  let el=null, filter="open", selecting=false;
  const selected=new Set();

  function groups(){
    const now=new Date(), today=isoDate(now), tomorrow=isoDate(addDays(now,1));
    const weekEnd=addDays(startOfWeek(now),7);
    // Tracked assessments can't be selected or deleted, only ticked off.
    const list=(selecting?state.tasks:allTaskItems()).filter(t=>filter==="done"?t.done:filter==="open"?!t.done:true)
      .sort((a,b)=>filter==="done"?taskDateTime(b)-taskDateTime(a):taskDateTime(a)-taskDateTime(b));
    if(filter==="done") return [["Completed",list]];
    const g={Overdue:[],Today:[],Tomorrow:[],"This week":[],Later:[],Done:[]};
    for(const t of list){
      if(t.done){ g.Done.push(t); continue; }
      if(isOverdue(t)) g.Overdue.push(t);
      else if(t.dueDate===today) g.Today.push(t);
      else if(t.dueDate===tomorrow) g.Tomorrow.push(t);
      else if(taskDateTime(t)<weekEnd) g["This week"].push(t);
      else g.Later.push(t);
    }
    return Object.entries(g).filter(([,v])=>v.length);
  }

  function render(){
    const open=allTaskItems().filter(t=>!t.done).length;
    const gs=groups();
    el.innerHTML=`
      ${pageHeader("Tasks",{
        eyebrow:`${open} open`,
        actions:state.tasks.length?`<button class="btn ghost sm" id="selectToggle">${selecting?"Done":"Select"}</button>`:""
      })}
      <div class="segmented">
        ${[["open","To do"],["done","Completed"],["all","All"]].map(([k,l])=>`<button class="${filter===k?"on":""}" data-filter="${k}">${l}</button>`).join("")}
      </div>
      ${gs.length?gs.map(([name,list])=>`
        <div class="group">
          <h4 class="group-title ${name==="Overdue"?"warn":""}">${name}<span>${list.length}</span></h4>
          <div class="card flush task-list">${list.map(t=>taskRowHTML(t,{selecting,selected:selected.has(t.id)})).join("")}</div>
        </div>`).join("")
      :`<div class="empty-state">${icon("M9 11l2 2 4-4M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z",40)}<h3>${filter==="done"?"Nothing completed yet":"All clear"}</h3><p>Tap + to add a task.</p></div>`}
      ${selecting?`<div class="select-bar"><span>${selected.size} selected</span><button class="btn ghost sm" id="selectAll">Select all</button><button class="btn danger sm" id="deleteSelected" ${selected.size?"":"disabled"}>Delete</button></div>`
        :`<button class="fab" id="addTask" aria-label="Add task">${icon("M12 5v14M5 12h14",26)}</button>`}`;

    $$("[data-filter]",el).forEach(b=>b.onclick=()=>{ filter=b.dataset.filter; render(); });
    $("#selectToggle",el)?.addEventListener("click",()=>{ selecting=!selecting; selected.clear(); render(); });
    $("#addTask",el)?.addEventListener("click",()=>openTaskForm());
    if(selecting){
      $$("[data-select-task]",el).forEach(b=>b.onclick=()=>{
        const id=b.dataset.selectTask;
        selected.has(id)?selected.delete(id):selected.add(id);
        render();
      });
      $$("[data-edit-task]",el).forEach(b=>b.onclick=()=>b.previousElementSibling?.click());
      $("#selectAll",el).onclick=()=>{
        const ids=gs.flatMap(([,l])=>l.map(t=>t.id));
        const all=ids.every(id=>selected.has(id));
        ids.forEach(id=>all?selected.delete(id):selected.add(id));
        render();
      };
      $("#deleteSelected",el).onclick=async()=>{
        if(!await confirmSheet(`Delete ${selected.size} task${selected.size===1?"":"s"}?`)) return;
        state.tasks=state.tasks.filter(t=>!selected.has(t.id));
        selected.clear(); selecting=false;
        save({immediate:true}); toast("Deleted");
      };
    }else bindTaskRows(el);
  }

  return {
    title:"Tasks",
    mount(c){ el=c; },
    show(){ render(); },
    refresh(){ render(); }
  };
})();
