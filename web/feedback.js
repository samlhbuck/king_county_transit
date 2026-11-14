/* Product feedback; explicit context preview and confirmed server receipt. */
window.FeedbackForm=class{
  constructor(context){
    this.context=context;this.dialog=document.getElementById('feedback-dialog');
    this.form=document.getElementById('feedback-form');this.status=document.getElementById('feedback-status');
    this.send=document.getElementById('feedback-submit');this.include=document.getElementById('feedback-include-context');
    document.addEventListener('feedback-open',()=>this.open());
    document.getElementById('close-feedback').addEventListener('click',()=>this.dialog.close());
    this.include.addEventListener('change',()=>this.preview());
    this.form.addEventListener('submit',event=>{event.preventDefault();this.submit();});
  }
  preview(){
    document.getElementById('feedback-context').textContent=this.include.checked?
      Object.entries(this.snapshot).map(([key,value])=>`${key}: ${value}`).join('\n'):'No route, stop or lens context will be sent.';
  }
  async open(){
    if(this.sending){this.dialog.showModal();return;}
    if(this.saved){this.form.reset();this.saved=false;this.submissionId=null;}
    for(const field of this.form.elements)field.disabled=false;
    this.snapshot=this.context();this.preview();this.send.disabled=true;
    this.status.textContent='Checking feedback availability…';this.dialog.showModal();
    try{
      const response=await fetch('/api/feedback');if(!response.ok)throw new Error();
      const state=await response.json();this.available=state.available===true;
      this.send.disabled=!this.available||this.sending;
      this.status.textContent=this.available?'':'Feedback storage is unavailable. Your draft stays here; please try again later.';
    }catch(error){this.available=false;this.status.textContent='Feedback is unavailable right now. Please try reopening this form.';}
  }
  async submit(){
    if(!this.available||this.sending||this.saved)return;
    this.sending=true;this.send.disabled=true;this.status.textContent='Sending feedback…';
    const payload={category:document.getElementById('feedback-category').value,text:document.getElementById('feedback-text').value,
      context:this.include.checked?this.snapshot:{},website:document.getElementById('feedback-website').value};
    const draft=JSON.stringify(payload);
    if(!this.submissionId||draft!==this.lastDraft){this.submissionId=crypto.randomUUID().replaceAll('-','');this.lastDraft=draft;}
    payload.submissionId=this.submissionId;
    for(const field of this.form.elements)field.disabled=true;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json','X-Route-Lens-Feedback':'1'},body:JSON.stringify(payload),signal:controller.signal});
      const result=await response.json();
      if(response.status!==201||result.stored!==true||!result.id)throw new Error(result.error||'Could not confirm storage. Please retry.');
      this.saved=true;this.status.textContent=`Feedback saved. Thank you. Receipt: ${result.id}`;
    }catch(error){this.status.textContent=error.name==='AbortError'?'Receipt could not be confirmed. Your draft is kept; please retry.':error.message||'Feedback could not be saved. Your draft is kept.';}
    finally{clearTimeout(timer);this.sending=false;for(const field of this.form.elements)field.disabled=this.saved;this.send.disabled=this.saved||!this.available;}
  }
};
