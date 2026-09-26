import {Simulation,QLearner,createScenario,matchedOrders,point,mean,COLORS} from './simulation.js';
const $=id=>document.getElementById(id);
const coordinate=node=>`(${node%10}, ${Math.floor(node/10)})`;
const clock=seconds=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const position=node=>{const p=point(node);return {x:95+p.x*52,y:30+p.y*52};};
let learner=new QLearner(), learned, greedy, running=false, speed=20, accumulator=0;
let visibleFleet='learned', history=[], training=false, mode='online', lastFrame=0, lastPaint=0;
let validationDescription='6 fixed validation scenarios';

function replay() {
  running=false;accumulator=0;
  const scenario=createScenario(42);
  learned=new Simulation(scenario,'learned',learner,{learning:mode==='online',epsilon:mode==='frozen'?0:undefined});
  greedy=new Simulation(scenario,'greedy');render();
}
function togglePlay() {
  if(training || (learned.done&&greedy.done)) return;
  running=!running;render();
}
function nextOrder() {
  if(training) return;
  running=false;
  const target=learned.nextOrder<learned.scenario.orders.length?learned.scenario.orders[learned.nextOrder].created:Infinity;
  do {learned.step();greedy.step();} while((learned.time<target || greedy.time<target) && !(learned.done&&greedy.done));
  accumulator=0;render();
}
function linePath(nodes) {return nodes.map((node,i)=>{const p=position(node);return `${i?'L':'M'}${p.x},${p.y}`;}).join(' ');}
function renderMap(sim) {
  let drawing='';
  for(let i=0;i<10;i++) {
    drawing+=`<text x="${95+i*52}" y="528" text-anchor="middle" fill="#7890a8" font-size="11">${i}</text>`;
    drawing+=`<text x="69" y="${34+i*52}" text-anchor="middle" fill="#7890a8" font-size="11">${i}</text>`;
  }
  for(const edge of sim.city.edges) {
    const a=position(edge.a),b=position(edge.b),intensity=Math.min(1,(edge.cost-1)/3.3);
    const color=`rgb(${Math.round(49+141*intensity)},${Math.round(72+44*intensity)},${Math.round(94-15*intensity)})`;
    drawing+=`<path d="M${a.x},${a.y}L${b.x},${b.y}" stroke="${color}" stroke-width="3" stroke-linecap="round"><title>Road ${edge.a}–${edge.b}: ${edge.cost.toFixed(2)} cost units / 100 m</title></path>`;
  }
  for(let node=0;node<100;node++) {const p=position(node);drawing+=`<circle cx="${p.x}" cy="${p.y}" r="2.8" fill="#72859a"/>`;}
  for(const courier of sim.couriers) {
    if(courier.phase==='pickup'||courier.phase==='delivery') drawing+=`<path d="${linePath(courier.path.slice(courier.pathIndex))}" fill="none" stroke="${COLORS[courier.id]}" stroke-width="4" opacity=".8" stroke-linejoin="round" ${courier.phase==='pickup'?'stroke-dasharray="5 5"':''}/>`;
  }
  const highlighted=new Map();
  for(const courier of sim.couriers) if(courier.queue[0]) highlighted.set(courier.queue[0].id,courier.queue[0]);
  if(sim.lastDecision && sim.lastDecision.order.delivered===undefined) highlighted.set(sim.lastDecision.order.id,sim.lastDecision.order);
  for(const order of highlighted.values()) {
    const r=position(order.restaurant),c=position(order.customer);
    drawing+=`<rect x="${r.x-7}" y="${r.y-7}" width="14" height="14" rx="3" fill="#ffb571" stroke="#13263c" stroke-width="2"><title>Order ${order.id+1} restaurant ${coordinate(order.restaurant)}</title></rect>`;
    drawing+=`<circle cx="${c.x}" cy="${c.y}" r="7" fill="#13263c" stroke="#f4f7fb" stroke-width="2"><title>Order ${order.id+1} customer ${coordinate(order.customer)}</title></circle>`;
  }
  for(const order of sim.completed.filter(order=>sim.time-order.delivered<25)) {
    const p=position(order.customer);
    drawing+=`<circle cx="${p.x}" cy="${p.y}" r="13" fill="#173e40" stroke="#32c7a3"/><text x="${p.x}" y="${p.y+4}" fill="#60e5bf" text-anchor="middle" font-size="13">✓</text><text x="${p.x}" y="${p.y-21}" fill="#96e9d1" text-anchor="middle" font-size="11">Delivered #${order.id+1}</text>`;
  }
  for(const courier of sim.couriers) {
    const a=position(courier.node),next=courier.path[courier.pathIndex+1],b=next===undefined?a:position(next);
    const fraction=(courier.phase==='pickup'||courier.phase==='delivery')?Math.min(.999,(courier.progress+(running?accumulator:0))/10):0;
    let x=a.x+(b.x-a.x)*fraction;const y=a.y+(b.y-a.y)*fraction;
    const coincident=sim.couriers.filter(c=>c.node===courier.node && c.progress===0 && courier.progress===0);
    if(coincident.length>1) x+=(coincident.findIndex(c=>c.id===courier.id)-(coincident.length-1)/2)*20;
    drawing+=`<circle cx="${x}" cy="${y}" r="18" fill="${COLORS[courier.id]}" opacity=".12"/><circle cx="${x}" cy="${y}" r="12" fill="${COLORS[courier.id]}" stroke="#13263c" stroke-width="3"/><text x="${x}" y="${y+4}" fill="#10283d" text-anchor="middle" font-size="11" font-weight="700">${'ABC'[courier.id]}</text>`;
  }
  $('cityMap').innerHTML=drawing;
  $('weather').textContent=`${sim.city.weather?'Rain event':'Clear'} · ${sim.city.rush>=.5?'Rush hour':'Light traffic'}`;
  $('clock').textContent=clock(Math.max(learned.time,greedy.time));
}
function renderCouriers(sim) {
  $('courierCards').innerHTML=sim.couriers.map(courier=>{
    const utilization=100*courier.busySeconds/Math.max(1,sim.time),order=courier.queue[0];
    let status='Idle';
    if(courier.phase==='pickup') status=`To restaurant · #${order.id+1}`;
    if(courier.phase==='prep') status=`Waiting for prep · ${Math.max(0,order.created+order.prep-sim.time)}s`;
    if(courier.phase==='delivery') status=`To customer · #${order.id+1}`;
    return `<div class="courier-card" style="--courier:${COLORS[courier.id]}"><span class="courier-dot">${'ABC'[courier.id]}</span><div class="courier-copy">${status}<small>Node ${coordinate(courier.node)} · ${Math.max(0,courier.queue.length-1)} queued · ${courier.delivered} delivered</small></div><div class="courier-util">${utilization.toFixed(0)}% busy<div class="util-track"><i style="width:${utilization}%"></i></div></div></div>`;
  }).join('');
  $('activeOrders').textContent=`${sim.orders.length-sim.completed.length} outstanding`;
  const decision=sim.lastDecision;if(!decision) return;
  const order=decision.order;
  $('orderNumber').textContent=`ORDER #${String(order.id+1).padStart(3,'0')}`;
  $('restaurantNode').textContent=coordinate(order.restaurant);$('customerNode').textContent=coordinate(order.customer);
  $('orderDetail').textContent=`Created ${clock(order.created)} · prep ${order.prep}s · ${order.delivered!==undefined?`delivered in ${order.deliveryTime}s`:`assigned to ${'ABC'[decision.courierId]}`}`;
  $('decisionType').textContent=sim.policy==='greedy'?'Lowest route cost':decision.exploring?'Exploration':'Highest Q value';
  $('decisionExplanation').innerHTML=`<span>${sim.policy==='greedy'?'Smallest additional route cost, from the end of the existing queue.':decision.exploring?'A random action gathers experience.':'The highest Q value selects a cost-ranked action.'} Estimates below were recorded at assignment.</span><table class="decision-table"><thead><tr><th>Courier</th><th>Cost</th><th>Free in</th><th>ETA</th><th>Q</th></tr></thead><tbody>${decision.candidates.map((c,i)=>`<tr class="${i===decision.action?'chosen':''}"><td>${'ABC'[c.courierId]}${i===decision.action?' ✓':''}</td><td>${c.cost.toFixed(1)}</td><td>${c.freeIn}s</td><td>${c.eta}s</td><td>${sim.policy==='greedy'?'—':decision.qValues[i].toFixed(2)}</td></tr>`).join('')}</tbody></table>`;
}
function chartSeries() {
  if($('chartMode').value==='training') return history.map(row=>({...row,x:row.episode}));
  const matched=matchedOrders(learned,greedy);
  return matched.map((row,index)=>{
    const window=matched.slice(Math.max(0,index-19),index+1);
    return {x:row.id+1,learned:mean(window.map(r=>r.learned)),greedy:mean(window.map(r=>r.greedy))};
  }).slice(-60);
}
function renderChart() {
  const series=chartSeries(),isTraining=$('chartMode').value==='training';
  $('chartDescription').textContent=isTraining?`Frozen policy · epsilon 0 · ${validationDescription}`:'Rolling mean over 20 matching order IDs · lower is better';
  $('chartEmpty').hidden=series.length>0;
  $('chartEmpty').textContent=isTraining?'Train a batch or load the benchmark policy to see measured learning progress.':'The first comparison appears when both fleets deliver the same order.';
  const maxY=Math.max(100,Math.ceil(Math.max(...series.flatMap(row=>[row.learned,row.greedy]),0)/100)*100);
  const minX=series[0]?.x||0,maxX=series.at(-1)?.x||1;
  // Use the actual panel width so labels stay readable on a phone.
  const chartWidth=Math.max(250,$('comparisonChart').clientWidth),right=chartWidth-15;
  $('comparisonChart').setAttribute('viewBox',`0 0 ${chartWidth} 210`);
  const x=value=>50+(value-minX)/Math.max(1,maxX-minX)*(right-50),y=value=>175-value/maxY*155;
  let svg='';
  for(let i=0;i<=4;i++) {
    const value=maxY*i/4,cy=y(value);
    svg+=`<line x1="50" y1="${cy}" x2="${right}" y2="${cy}" stroke="#e9edf2" stroke-dasharray="4 5"/><text x="41" y="${cy+4}" text-anchor="end" fill="#8b98a8" font-size="12">${Math.round(value)}s</text>`;
  }
  for(const [key,color] of [['greedy','#8192aa'],['learned','#f68c52']]) if(series.length) {
    svg+=`<path d="${series.map((row,i)=>`${i?'L':'M'}${x(row.x)},${y(row[key])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    for(const row of series) svg+=`<circle cx="${x(row.x)}" cy="${y(row[key])}" r="${series.length<10?4:2}" fill="${color}"><title>${isTraining?'Episode':'Order'} ${row.x}: ${key} ${row[key].toFixed(1)}s</title></circle>`;
  }
  if(series.length) svg+=`<text x="50" y="203" fill="#8b98a8" font-size="12">${minX}</text><text x="${right}" y="203" text-anchor="end" fill="#8b98a8" font-size="12">${maxX} ${isTraining?'episodes':'order ID'}</text>`;
  $('comparisonChart').innerHTML=svg;
  const last=series.at(-1);
  $('chartSummary').textContent=last?`${isTraining?'Latest validation':'Latest rolling mean'}: learned ${last.learned.toFixed(1)}s · greedy ${last.greedy.toFixed(1)}s${isTraining&&last.eta?` · queue-aware ETA ${last.eta.toFixed(1)}s`:''}`:'Identical demand and road conditions. No invented performance data.';
}
function render() {
  const sim=visibleFleet==='learned'?learned:greedy;renderMap(sim);renderCouriers(sim);renderChart();
  const a=learned.summary(),b=greedy.summary();
  $('learnedMean').innerHTML=`${a.delivered?a.meanDelivery.toFixed(0):'—'}<small> sec</small>`;
  $('greedyMean').innerHTML=`${b.delivered?b.meanDelivery.toFixed(0):'—'}<small> sec</small>`;
  $('learnedCount').textContent=`${a.delivered} delivered · ${learned.orders.length-a.delivered} outstanding`;
  $('greedyCount').textContent=`${b.delivered} delivered · ${greedy.orders.length-b.delivered} outstanding`;
  const matched=matchedOrders(learned,greedy);
  const advantage=matched.length?100*(mean(matched.map(r=>r.greedy))-mean(matched.map(r=>r.learned)))/mean(matched.map(r=>r.greedy)):null;
  $('advantage').innerHTML=`${advantage===null?'—':`${advantage>0?'+':''}${advantage.toFixed(1)}`}<small> %</small>`;
  $('matchedCount').textContent=`${matched.length} matching orders · positive = learned faster`;
  $('epsilonValue').innerHTML=`${mode==='frozen'?0:(learner.epsilon*100).toFixed(0)}<small> %</small>`;
  $('trainingCount').textContent=`${learner.decisions.toLocaleString()} training decisions · ${mode==='frozen'?'evaluation':'learning'}`;
  $('qStates').textContent=`${learner.table.size.toLocaleString()} states visited`;
  $('playButton').textContent=running?'Ⅱ Pause':'▶ Play';
  $('playButton').disabled=training || (learned.done&&greedy.done);$('stepButton').disabled=training || (learned.done&&greedy.done);
  $('episodeStatus').textContent=training?'TRAINING':learned.done&&greedy.done?'COMPLETE':running?'RUNNING':'PAUSED';
  $('mapSubtitle').textContent=`${visibleFleet==='learned'?'Learned':'Greedy'} dispatcher · seed 42 · ${sim.orders.length}/40 orders arrived`;
  $('showLearned').setAttribute('aria-pressed',String(visibleFleet==='learned'));$('showGreedy').setAttribute('aria-pressed',String(visibleFleet==='greedy'));
}
function setTraining(busy) {
  training=busy;running=false;
  for(const id of ['trainButton','restartButton','loadPolicy','resetLearning','policyMode']) $(id).disabled=busy;
  $('trainingProgress').hidden=!busy;render();
}
function trainBatch() {
  if(training) return;
  setTraining(true);$('trainingProgress').value=0;$('trainingStatus').textContent='Training in the background…';
  const worker=new Worker(new URL('./training-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    if(data.type==='progress') {
      $('trainingProgress').value=data.completed;$('trainingStatus').textContent=`${data.completed} / 200 episodes · evaluation uses epsilon 0`;
    } else if(data.type==='complete') {
      learner=QLearner.restore(data.learner);
      // Do not combine curves based on different validation sets.
      if(validationDescription!=='6 fixed validation scenarios') history=[];
      const byEpisode=new Map([...history,...data.history].map(row=>[row.episode,row]));
      history=[...byEpisode.values()].sort((a,b)=>a.episode-b.episode);validationDescription='6 fixed validation scenarios';
      $('chartMode').value='training';$('trainingStatus').textContent=`Completed ${learner.episodes.toLocaleString()} episodes. Replayed seed 42. Learning can fluctuate.`;
      worker.terminate();setTraining(false);replay();
    } else if(data.type==='error') {worker.terminate();setTraining(false);$('trainingStatus').textContent=`Training failed: ${data.message}`;}
  };
  worker.onerror=event=>{worker.terminate();setTraining(false);$('trainingStatus').textContent=`Training could not start: ${event.message}`;};
  worker.postMessage({learner:learner.serialize(),episodes:200});
}
async function loadPolicy() {
  if(training) return;setTraining(true);
  try {
    const responses=await Promise.all([fetch('trained-policy.json'),fetch('benchmark-results.json')]);
    if(responses.some(response=>!response.ok)) throw new Error('Benchmark artifacts are unavailable. Use Train 200 episodes.');
    const [policy,results]=await Promise.all(responses.map(response=>response.json()));
    learner=QLearner.restore(policy);history=results.history;validationDescription='10 fixed validation scenarios';
    mode='frozen';$('policyMode').value='frozen';$('chartMode').value='training';
    const s=results.summary;
    $('trainingStatus').textContent=`Loaded ${learner.episodes.toLocaleString()} episodes. Held-out: learned ${s.learned.toFixed(1)}s, greedy ${s.greedy.toFixed(1)}s, ETA ${s.eta.toFixed(1)}s. Replay uses epsilon 0.`;
    setTraining(false);replay();
  } catch(error) {setTraining(false);$('trainingStatus').textContent=error.message;}
}
function exportResults() {
  const result={seed:42,mode,epsilon:mode==='frozen'?0:learner.epsilon,learned:learned.summary(),greedy:greedy.summary(),
    matched:matchedOrders(learned,greedy),learnedOrders:learned.orders,greedyOrders:greedy.orders,history,policy:learner.serialize()};
  const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='dispatch-lab-results.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('playButton').onclick=togglePlay;$('stepButton').onclick=nextOrder;$('restartButton').onclick=replay;
$('speed').onchange=()=>{speed=Number($('speed').value);};
$('showLearned').onclick=()=>{visibleFleet='learned';render();};$('showGreedy').onclick=()=>{visibleFleet='greedy';render();};
$('chartMode').onchange=renderChart;$('trainButton').onclick=trainBatch;$('loadPolicy').onclick=loadPolicy;$('exportButton').onclick=exportResults;
$('policyMode').onchange=()=>{mode=$('policyMode').value;replay();};
$('resetLearning').onclick=()=>{learner=new QLearner();history=[];mode='online';$('policyMode').value='online';$('trainingStatus').textContent='Learning reset. Starting from random assignment.';replay();};
$('guideButton').onclick=async()=>{
  $('guideDialog').showModal();
  if(!$('guideContent').innerHTML) {
    try {const response=await fetch('guide.html');if(!response.ok) throw new Error();$('guideContent').innerHTML=await response.text();}
    catch {$('guideContent').textContent='The design guide could not load. See DESIGN.md and ASSUMPTIONS.md in the project.';}
  }
};
$('closeGuide').onclick=()=>$('guideDialog').close();
window.addEventListener('resize',()=>renderChart());
replay();
function frame(timestamp) {
  const elapsed=lastFrame?Math.min(.25,(timestamp-lastFrame)/1000):0;lastFrame=timestamp;
  if(running && !document.hidden) {
    accumulator+=elapsed*speed;
    while(accumulator>=1) {learned.step();greedy.step();accumulator--;}
    if(learned.done&&greedy.done) {running=false;render();}
  }
  if(timestamp-lastPaint>50 && running) {render();lastPaint=timestamp;}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Optional browser capability; uses the same playback actions as the buttons.
const modelContext=document.modelContext;
if(modelContext?.registerTool) {
  const lifecycle=new AbortController();
  try {
    Promise.resolve(modelContext.registerTool({name:'control_dispatch_simulation',title:'Control courier simulation',
      description:'Play, pause, or advance the visible courier simulation to its next order. Does not reset learning.',
      inputSchema:{type:'object',properties:{action:{type:'string',enum:['play','pause','next_order']}},required:['action'],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute(input) {
        if(!input || Object.keys(input).length!==1 || !['play','pause','next_order'].includes(input.action)) throw new Error('Expected action: play, pause, or next_order.');
        if(training) throw new Error('Wait for training to finish.');
        if(input.action==='next_order') nextOrder();else {running=input.action==='play' && !(learned.done&&greedy.done);render();}
        return {running,time:Math.max(learned.time,greedy.time),learned:learned.summary(),greedy:greedy.summary()};
      }},{signal:lifecycle.signal})).catch(()=>{});
    window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  } catch { /* All visible controls work without this experimental browser API. */ }
}
