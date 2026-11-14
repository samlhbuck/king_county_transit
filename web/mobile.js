/* Mobile map frame and temporary detail panels. */
if(typeof window!=='undefined')window.MobileRides=class{
  constructor(){
    this.media=window.matchMedia('(max-width: 650px)');
    this.mode='map';this.level=0;
    // Repair document offsets only at normal browser scale, after focus has
    // settled. Never undo deliberate zoom when settling document offsets.
    this.settleViewport=()=>{
      cancelAnimationFrame(this.viewportFrame);
      this.viewportFrame=requestAnimationFrame(()=>{
        if(!this.media.matches || (window.visualViewport?.scale||1)>1.05)return;
        const active=document.activeElement;
        if(active?.matches('input,textarea,select,[contenteditable=true]'))return;
        if(window.scrollX||window.scrollY)window.scrollTo({top:0,left:0,behavior:'instant'});
      });
    };
    window.visualViewport?.addEventListener('resize',this.settleViewport);
    window.visualViewport?.addEventListener('scroll',this.settleViewport);
    window.addEventListener('resize',this.settleViewport);
    document.addEventListener('focusout',this.settleViewport);
    document.addEventListener('route-loaded',this.settleViewport);
    document.addEventListener('close',event=>{
      if(event.target instanceof HTMLDialogElement)this.settleViewport();
    },true);
    this.dialog=document.getElementById('origin-dialog');
    document.getElementById('open-origin').addEventListener('click',()=>{
      document.querySelector('.mobile-route-picker')?.setAttribute('open','');
    });
    document.getElementById('close-origin').addEventListener('click',()=>this.dialog.close());
    this.origin=document.querySelector('.origin-panel');
    this.anchor=document.createComment('desktop origin panel');this.origin.before(this.anchor);
    this.sheet=document.getElementById('mobile-sheet');
    this.handle=document.getElementById('mobile-sheet-handle');
    this.nearby=document.getElementById('mobile-nearby');this.details=document.getElementById('mobile-details');
    this.nearby.textContent='⌖ Nearby routes';this.details.textContent='ⓘ';this.details.setAttribute('aria-label','Route info');this.details.title='Route info';
    this.nearby.hidden=true;
    this.details.addEventListener('click',()=>this.setMode(this.mode==='details'?'map':'details'));
    this.handle.addEventListener('click',()=>{if(!this.dragged)this.setLevel(this.level===2?0:this.level+1);this.dragged=false;});
    this.handle.addEventListener('pointerdown',e=>{this.dragged=false;this.startY=e.clientY;this.handle.setPointerCapture(e.pointerId);});
    this.handle.addEventListener('pointerup',e=>{
      if(this.startY==null)return;
      const delta=this.startY-e.clientY;
      if(Math.abs(delta)>25){this.dragged=true;this.setLevel(Math.max(0,Math.min(2,this.level+(delta>0?1:-1))));}
      this.startY=null;
    });
    this.handle.addEventListener('pointercancel',()=>{this.startY=null;});
    this.detailPanel=document.createElement('section');this.detailPanel.id='mobile-detail-panel';
    this.detailPanel.setAttribute('aria-label','Route details');document.body.append(this.detailPanel);
    this.scrollBody=document.createElement('div');this.scrollBody.id='mobile-detail-body';this.detailPanel.append(this.scrollBody);
    this.stopNavigation=document.querySelector('.summary-toggle');this.navigationAnchor=document.createComment('desktop stop navigation');this.stopNavigation.before(this.navigationAnchor);
    this.connectionFooter=document.createElement('footer');this.connectionFooter.className='stop-card-footer';this.detailPanel.append(this.connectionFooter);
    this.detailNodes=[document.querySelector('.route-tools'),...document.querySelectorAll('.map-panel > :not(.map-wrap):not(.panel-heading):not(#frontage-lens)'),document.querySelector('.workspace > aside'),...document.querySelectorAll('#dashboard > .projects-panel,#dashboard > details')].filter(Boolean).map(node=>{
      const anchor=document.createComment('desktop details');node.before(anchor);return {node,anchor};
    });
    const zoning=document.getElementById('show-zoning');
    this.zoningAnchor=document.createComment('desktop zoning control');zoning.parentElement.before(this.zoningAnchor);
    this.zoningControl=zoning.parentElement;this.zoningControl.classList.add('map-zoning-toggle');
    this.detailHandle=document.createElement('button');this.detailHandle.id='mobile-detail-handle';
    this.detailHandle.textContent='Expand details';this.detailHandle.addEventListener('click',()=>{if(this.detailDragged){this.detailDragged=false;return;}this.setDetailLevel(this.detailLevel===2?1:2);});
    this.closeDetails=document.createElement('button');this.closeDetails.id='mobile-close-details';this.closeDetails.textContent='×';this.closeDetails.setAttribute('aria-label','Close route details');this.closeDetails.title='Close route details';this.closeDetails.addEventListener('click',()=>this.setMode('map'));
    this.cardHeader=document.createElement('div');this.cardHeader.className='stop-card-header';
    this.transfers=document.getElementById('transfers');this.transfers.setAttribute('aria-label','Connecting routes');
    this.transfersAnchor=document.createComment('desktop connections');this.transfers.before(this.transfersAnchor);
    this.cardHeader.append(this.closeDetails);
    this.closeDetails.addEventListener('click',()=>document.getElementById('open-guide').focus({preventScroll:true}));
    const general=document.createElement('button');general.textContent='How to explore';general.addEventListener('click',()=>document.dispatchEvent(new Event('general-guide-request')));this.cardHeader.append(general);
    this.connectionToggle=document.createElement('button');this.connectionToggle.className='connection-toggle';this.connectionToggle.setAttribute('aria-expanded','false');this.connectionToggle.setAttribute('aria-controls','connection-list');
    this.connectionList=document.createElement('div');this.connectionList.id='connection-list';this.connectionList.hidden=true;this.detailPanel.append(this.connectionList);
    this.setConnectionsOpen=open=>{
      this.connectionList.hidden=!open;
      this.connectionToggle.setAttribute('aria-expanded',String(open));
      this.connectionToggle.textContent=`Connections (${this.transfers.children.length}) ${open?'▴':'▾'}`;
    };
    this.connectionToggle.addEventListener('click',()=>this.setConnectionsOpen(this.connectionList.hidden));
    this.connectionList.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.setConnectionsOpen(false);this.connectionToggle.focus({preventScroll:true});}
    });
    this.scrollBody.addEventListener('click',()=>this.setConnectionsOpen(false));
    this.refreshConnections=()=>{
      if(!this.media.matches)return;
      const count=this.transfers.children.length;
      this.connectionList.hidden=true;this.connectionToggle.setAttribute('aria-expanded','false');
      this.connectionToggle.textContent=`Connections (${count}) ▾`;
      this.connectionFooter.replaceChildren();
      if(count>4){this.connectionFooter.append(this.connectionToggle);this.connectionList.append(this.transfers);}
      else this.connectionFooter.append(this.transfers);
      this.connectionFooter.hidden=!count;
    };
    this.connectionObserver=new MutationObserver(this.refreshConnections);this.connectionObserver.observe(this.transfers,{childList:true});
    this.detailPanel.prepend(this.detailHandle,this.cardHeader);
    let start=null;
    this.detailHandle.addEventListener('pointerdown',e=>{this.detailDragged=false;start=e.clientY;this.detailHandle.setPointerCapture(e.pointerId);});
    this.detailHandle.addEventListener('pointerup',e=>{if(start==null)return;const delta=start-e.clientY;start=null;if(Math.abs(delta)>25){this.detailDragged=true;this.setDetailLevel(delta>0?2:1);if(delta< -80)this.setMode('map');}});
    this.detailHandle.addEventListener('pointercancel',()=>start=null);
    this.routeTools=document.querySelector('.route-tools');this.toolsAnchor=document.createComment('route picker location');this.routeTools.before(this.toolsAnchor);
    this.filters=document.getElementById('open-filters');this.filtersAnchor=document.createComment('desktop filters');this.filters.before(this.filtersAnchor);
    this.departures=document.getElementById('departure-lens');this.departuresAnchor=document.createComment('departure location');this.departures.before(this.departuresAnchor);
    document.addEventListener('route-stop-selected',()=>{this.focusContext=null;if(this.media.matches&&this.mode==='details')this.setMode('map');});
    document.addEventListener('route-stop-inspect',e=>{if(this.media.matches){this.focusContext=e.detail;this.setDetailLevel(1);this.setMode('details');this.detailPanel.tabIndex=-1;this.detailPanel.setAttribute('aria-label',`Stop details: ${e.detail.stop.name}`);this.detailPanel.focus({preventScroll:true});}});
    this.detailPanel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();this.setMode('map');document.getElementById('open-guide').focus({preventScroll:true});}});
    document.getElementById('map').addEventListener('click',e=>{if(this.media.matches&&this.mode==='details'&&!e.target.closest('[role=button]'))this.setMode('map');});
    document.addEventListener('project-card-open',()=>{if(this.media.matches)this.setMode('map');});
    const stripToggle=document.createElement('button');stripToggle.id='mobile-strip-toggle';stripToggle.textContent='Hide profile';stripToggle.setAttribute('aria-expanded','true');
    stripToggle.addEventListener('click',()=>{const collapsed=document.body.classList.toggle('profile-collapsed');stripToggle.textContent=collapsed?'Show profile':'Hide profile';stripToggle.setAttribute('aria-expanded',String(!collapsed));});document.getElementById('frontage-lens').prepend(stripToggle);
    this.setDetailLevel(1);
    this.media.addEventListener('change'  ,()=>this.update());this.update();
  }
  setDetailLevel(level){this.detailLevel=level;this.detailPanel.dataset.level=String(level);this.detailHandle.textContent=level===2?'⌄':'⌃';this.detailHandle.setAttribute('aria-label',level===2?'Collapse details':'Expand details');this.detailHandle.title=level===2?'Collapse details':'Expand details';this.detailHandle.setAttribute('aria-expanded',String(level===2));if(this.focusContext&&!this.focusContext.preserveView&&!this.detailPanel.hidden)this.focusContext.map.placeInfoCard(this.detailPanel,this.focusContext.stop);}
  setLevel(level){
    this.level=level;this.sheet.dataset.level=String(level);document.body.dataset.sheetLevel=String(level);
    this.handle.setAttribute('aria-label',level===2?'Collapse nearby rides panel':'Expand nearby rides panel');
    this.handle.setAttribute('aria-expanded',String(level>0));
  }
  setMode(mode){
    const active=document.activeElement;
    if(this.media.matches && (active?.closest('.mobile-route-picker') || (mode==='map' && this.detailPanel.contains(active))))active.blur();
    document.querySelector('.mobile-route-picker')?.removeAttribute('open');
    this.mode=mode;this.update();this.settleViewport();
    if(mode==='map')document.dispatchEvent(new Event('mobile-details-closed'));
  }
  update(){
    const mobile=this.media.matches;
    // Reparent only when crossing the desktop/mobile breakpoint. Repeatedly
    // moving focused panels can trigger browser focus scrolling and keyboard churn.
    if(this.layoutMobile!==mobile){
    for(const {node,anchor} of this.detailNodes){if(mobile)this.scrollBody.append(node);else anchor.after(node);}
    if(mobile){this.scrollBody.append(this.filters);document.body.append(this.routeTools);document.getElementById('route-summary').append(this.departures);}else{this.filtersAnchor.after(this.filters);this.toolsAnchor.after(this.routeTools);this.departuresAnchor.after(this.departures);}
    this.layoutMobile=mobile;
    }
    document.body.dataset.mobileMode=this.mode;
    if(mobile){this.cardHeader.prepend(this.stopNavigation);this.refreshConnections();}
    else{this.connectionList.hidden=true;this.navigationAnchor.after(this.stopNavigation);this.transfersAnchor.after(this.transfers);}
    this.detailPanel.hidden=!mobile||this.mode!=='details';
    document.body.classList.toggle('mobile-map-app',mobile);
    document.documentElement.classList.toggle('mobile-map-frame',mobile);
    if(mobile)document.querySelector('.map-wrap').append(this.zoningControl);else this.zoningAnchor.after(this.zoningControl);

    this.dialog.close();
    document.getElementById('cancel-pin').click();
    document.body.classList.toggle('mobile-nearby',mobile&&this.mode==='nearby');
    this.sheet.hidden=!mobile||this.mode!=='nearby';
    this.nearby.setAttribute('aria-pressed',String(this.mode==='nearby'));
    this.details.setAttribute('aria-pressed',String(this.mode==='details'));
    this.anchor.after(this.origin);
    this.setLevel(this.level);this.settleViewport();
  }
};
