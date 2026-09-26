// The simulation has no DOM dependencies: the browser and benchmark use this same code.
export const SETTINGS = Object.freeze({size:10, couriers:3, edgeMeters:100, speed:10,
  meanArrivalSeconds:55, ordersPerEpisode:40, costUpdateSeconds:30,
  alpha:0.12, gamma:0.92, epsilonFloor:0.05, epsilonDecay:3500,
  delayScale:100, detourPenalty:0.03, balancePenaltyPerSecond:0.0002});
export const COLORS = ['#32c7a3','#4389ec','#c29afb'];
export const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0;
export const point = node => ({x:node%10, y:Math.floor(node/10)});
export const manhattan = (a,b) => Math.abs(a%10-b%10)+Math.abs(Math.floor(a/10)-Math.floor(b/10));

// Mulberry32: seed all exogenous events independently of policy exploration.
export function randomGenerator(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let mixed = Math.imul(value ^ value>>>15, 1|value);
    mixed ^= mixed + Math.imul(mixed ^ mixed>>>7, 61|mixed);
    return ((mixed ^ mixed>>>14)>>>0)/4294967296;
  };
}
export function createScenario(seed=42, count=SETTINGS.ordersPerEpisode) {
  const random = randomGenerator(seed);
  const starts = Array.from({length:3},()=>Math.floor(random()*100));
  const orders = [];
  let time = 0;
  for(let id=0;id<count;id++) {
    if(id) time += Math.max(1,Math.round(-Math.log(1-random())*SETTINGS.meanArrivalSeconds));
    const restaurant = Math.floor(random()*100);
    let customer = Math.floor(random()*99);
    if(customer>=restaurant) customer++;
    orders.push({id, created:time, restaurant, customer, prep:20+Math.floor(random()*81)});
  }
  const weather = [];
  // Keep weather going through queue-draining time as well as order arrivals.
  for(let start=180;start<time+20000;start+=300) {
    if(random()<0.35) weather.push({start,end:start+90+Math.floor(random()*91),
      column:Math.floor(random()*8), strength:0.6+random()*0.7});
  }
  return {seed, starts, orders, weather};
}

export class City {
  constructor(scenario) {
    this.scenario=scenario;
    this.edges=[];
    this.neighbors=Array.from({length:100},()=>[]);
    const random=randomGenerator(scenario.seed+81231);
    for(let node=0;node<100;node++) {
      const next=[];
      if(node%10<9) next.push(node+1);
      if(node<90) next.push(node+10);
      for(const to of next) {
        const edge={a:node,b:to,condition:1+random()*0.18,cost:1};
        this.edges.push(edge);
        this.neighbors[node].push({node:to,edge});
        this.neighbors[to].push({node,edge});
      }
    }
    this.bucket=-1;
    this.cache=new Map();
    this.update(0);
  }
  update(time) {
    const bucket=Math.floor(time/SETTINGS.costUpdateSeconds);
    if(bucket===this.bucket) return;
    this.bucket=bucket;
    this.cache.clear();
    const sampleTime=bucket*SETTINGS.costUpdateSeconds;
    this.rush=Math.max(0,Math.sin(2*Math.PI*sampleTime/900));
    this.weather=this.scenario.weather.find(event=>sampleTime>=event.start && sampleTime<event.end);
    for(const edge of this.edges) {
      const a=point(edge.a), b=point(edge.b);
      const central=(a.x>=3 && a.x<=6)||(a.y>=4 && a.y<=5);
      const traffic=this.rush*(central?1.8:0.25);
      const rain=this.weather && Math.abs((a.x+b.x)/2-this.weather.column)<=2 ? this.weather.strength : 0;
      edge.cost=edge.condition*(1+traffic+rain);
    }
  }
  route(start,end) {
    // Cache a Dijkstra tree per source for this road-cost snapshot.
    if(!this.cache.has(start)) {
      const distance=Array(100).fill(Infinity), previous=Array(100).fill(-1), visited=Array(100).fill(false);
      distance[start]=0;
      for(let count=0;count<100;count++) {
        let current=-1;
        for(let node=0;node<100;node++) if(!visited[node] && (current<0 || distance[node]<distance[current])) current=node;
        if(current<0 || !Number.isFinite(distance[current])) break;
        visited[current]=true;
        for(const neighbor of this.neighbors[current]) {
          const cost=distance[current]+neighbor.edge.cost;
          if(cost<distance[neighbor.node]-1e-9) { distance[neighbor.node]=cost; previous[neighbor.node]=current; }
        }
      }
      this.cache.set(start,{distance,previous});
    }
    const {distance,previous}=this.cache.get(start);
    const path=[end];
    while(path[0]!==start) path.unshift(previous[path[0]]);
    return {path,cost:distance[end],seconds:(path.length-1)*10,edges:path.length-1};
  }
}

export class QLearner {
  constructor() { this.table=new Map(); this.visits=new Map(); this.decisions=0; this.episodes=0; }
  get epsilon() { return Math.max(SETTINGS.epsilonFloor,Math.exp(-this.decisions/SETTINGS.epsilonDecay)); }
  values(state) { if(!this.table.has(state)) this.table.set(state,[0,0,0]); return this.table.get(state); }
  choose(state,random,epsilon=this.epsilon) {
    if(random()<epsilon) return {action:Math.floor(random()*3),exploring:true};
    const values=this.table.get(state)||[0,0,0], best=Math.max(...values);
    const ties=[0,1,2].filter(action=>Math.abs(values[action]-best)<1e-9);
    return {action:ties[Math.floor(random()*ties.length)],exploring:false};
  }
  update(state,action,reward,nextState) {
    const values=this.values(state);
    const future=nextState===null?0:Math.max(...this.values(nextState));
    values[action]+=SETTINGS.alpha*(reward+SETTINGS.gamma*future-values[action]);
    const visits=this.visits.get(state)||[0,0,0]; visits[action]++; this.visits.set(state,visits);
  }
  serialize() { return {table:[...this.table],visits:[...this.visits],decisions:this.decisions,episodes:this.episodes}; }
  static restore(data) {
    const learner=new QLearner();
    learner.table=new Map(data.table); learner.visits=new Map(data.visits);
    learner.decisions=data.decisions; learner.episodes=data.episodes;
    return learner;
  }
}

export class Simulation {
  constructor(scenario,policy='learned',learner=new QLearner(),{learning=true,epsilon}={}) {
    this.scenario=scenario; this.policy=policy; this.learner=learner;
    this.learning=learning && policy==='learned'; this.fixedEpsilon=epsilon;
    this.random=randomGenerator(scenario.seed+541019);
    this.city=new City(scenario); this.time=0; this.nextOrder=0; this.done=false;
    this.couriers=scenario.starts.map((node,id)=>({id,node,queue:[],phase:'idle',path:[node],pathIndex:0,progress:0,busySeconds:0,delivered:0}));
    this.orders=[]; this.completed=[]; this.lastDecision=null; this.pendingTransition=null;
    this.intervalReward=0; this.totalReward=0; this.orderSeconds=0; this.extraEdges=0;
    this.processArrivals();
  }
  beginLeg(courier,destination,phase) {
    const route=this.city.route(courier.node,destination);
    const detour=route.edges-manhattan(courier.node,destination);
    this.extraEdges+=detour;
    this.addReward(-SETTINGS.detourPenalty*detour);
    courier.path=route.path; courier.pathIndex=0; courier.progress=0; courier.phase=phase;
    this.resolveAtNode(courier);
  }
  resolveAtNode(courier) {
    // Handles zero-length pickup routes, pickup readiness, and queue handoff.
    const order=courier.queue[0];
    if(!order) {courier.phase='idle'; return;}
    if(courier.pathIndex<courier.path.length-1) return;
    if(courier.phase==='pickup') {
      courier.phase='prep'; order.restaurantArrival=this.time;
    }
    if(courier.phase==='prep' && this.time>=order.created+order.prep) {
      order.pickup=this.time;
      this.beginLeg(courier,order.customer,'delivery');
    } else if(courier.phase==='delivery') {
      order.delivered=this.time; order.deliveryTime=this.time-order.created;
      this.completed.push(order); courier.delivered++; courier.queue.shift();
      if(courier.queue.length) this.beginLeg(courier,courier.queue[0].restaurant,'pickup');
      else courier.phase='idle';
    }
  }
  addReward(reward) {this.intervalReward+=reward; this.totalReward+=reward;}
  forecast(courier) {
    // Follow the existing queue, estimating future legs at CURRENT costs only.
    let time=this.time, node=courier.node, remainingOrderSeconds=0;
    for(let index=0;index<courier.queue.length;index++) {
      const order=courier.queue[index];
      if(index===0) {
        const remaining=(courier.path.length-1-courier.pathIndex)*10-courier.progress;
        if(courier.phase==='delivery') {time+=remaining; node=order.customer; remainingOrderSeconds+=time-this.time; continue;}
        if(courier.phase==='pickup') time+=remaining;
      } else time+=this.city.route(node,order.restaurant).seconds;
      time=Math.max(time,order.created+order.prep);
      time+=this.city.route(order.restaurant,order.customer).seconds;
      node=order.customer;
      remainingOrderSeconds+=time-this.time;
    }
    return {node,freeIn:time-this.time,remainingOrderSeconds};
  }
  candidates(order) {
    return this.couriers.map(courier=>{
      const forecast=this.forecast(courier);
      const pickup=this.city.route(forecast.node,order.restaurant);
      const delivery=this.city.route(order.restaurant,order.customer);
      return {courierId:courier.id,freeIn:forecast.freeIn,cost:pickup.cost+delivery.cost,
        eta:Math.max(this.time+forecast.freeIn+pickup.seconds,order.created+order.prep)+delivery.seconds-order.created,
        pickupSeconds:pickup.seconds,deliverySeconds:delivery.seconds,queueLength:courier.queue.length};
    }).sort((a,b)=>a.cost-b.cost || a.courierId-b.courierId);
  }
  stateKey(candidates,order) {
    // Canonical action order = ascending additional route cost, NOT fixed IDs.
    // 3 ETA bins × 3 availability bins per courier; 2 prep × 2 rush bins.
    // At most (3*3)^3*2*2 = 2,916 rows, each with 3 Q values.
    const best=Math.min(...candidates.map(candidate=>candidate.eta));
    const bins=candidates.map(candidate=>{
      const gap=candidate.eta-best;
      const etaBin=gap<=10?0:gap<=60?1:2;
      const freeBin=candidate.freeIn===0?0:candidate.freeIn<=100?1:2;
      return `${etaBin}${freeBin}`;
    });
    return `${bins.join('-')}:${order.prep<=60?0:1}:${this.city.rush>=0.5?1:0}`;
  }
  processArrivals() {
    while(this.nextOrder<this.scenario.orders.length && this.scenario.orders[this.nextOrder].created<=this.time) {
      const order={...this.scenario.orders[this.nextOrder++]};
      const candidates=this.candidates(order), state=this.stateKey(candidates,order);
      // Potential-based shaping gives earlier credit without replacing the base
      // objective. Phi is negative estimated remaining order-seconds; terminal=0.
      // With aggregation, this remains a practical approximation, not a proof.
      const potential=-this.couriers.reduce((sum,c)=>sum+this.forecast(c).remainingOrderSeconds,0)/SETTINGS.delayScale;
      if(this.learning && this.pendingTransition) {
        const previous=this.pendingTransition;
        const shapedReward=this.intervalReward+SETTINGS.gamma*potential-previous.potential;
        this.learner.update(previous.state,previous.action,shapedReward,state);
      }
      this.intervalReward=0;
      let action=0, exploring=false;
      if(this.policy==='learned') ({action,exploring}=this.learner.choose(state,this.random,this.fixedEpsilon??this.learner.epsilon));
      if(this.policy==='eta') action=candidates.reduce((best,candidate,index)=>candidate.eta<candidates[best].eta?index:best,0);
      if(this.policy==='random') action=Math.floor(this.random()*3);
      const candidate=candidates[action], courier=this.couriers[candidate.courierId];
      this.lastDecision={order,candidates,state,action,exploring,courierId:courier.id,
        epsilon:this.fixedEpsilon??this.learner.epsilon,qValues:[...(this.learner.table.get(state)||[0,0,0])]};
      this.pendingTransition={state,action,potential};
      if(this.learning) this.learner.decisions++;
      order.courierId=courier.id; this.orders.push(order); courier.queue.push(order);
      if(courier.queue.length===1) this.beginLeg(courier,order.restaurant,'pickup');
    }
  }
  step() {
    if(this.done) return;
    const outstanding=this.orders.length-this.completed.length;
    this.orderSeconds+=outstanding;
    this.addReward(-outstanding/SETTINGS.delayScale);
    const busy=this.couriers.map(c=>c.busySeconds);
    const imbalance=(Math.max(...busy)-Math.min(...busy))/Math.max(1,this.time);
    this.addReward(-SETTINGS.balancePenaltyPerSecond*imbalance);
    this.time++; this.city.update(this.time);
    for(const courier of this.couriers) {
      if(!courier.queue.length) continue;
      courier.busySeconds++;
      if(courier.phase==='pickup' || courier.phase==='delivery') {
        courier.progress++;
        if(courier.progress>=10) {
          courier.progress=0; courier.pathIndex++; courier.node=courier.path[courier.pathIndex];
        }
      }
      this.resolveAtNode(courier);
    }
    this.processArrivals();
    if(this.nextOrder===this.scenario.orders.length && this.completed.length===this.scenario.orders.length) {
      this.done=true;
      if(this.learning && this.pendingTransition) {
        this.learner.update(this.pendingTransition.state,this.pendingTransition.action,this.intervalReward-this.pendingTransition.potential,null);
        this.learner.episodes++;
      }
      this.pendingTransition=null;
    }
  }
  run() {
    while(!this.done && this.time<200000) this.step();
    if(!this.done) throw new Error('Episode did not drain; check arrivals or movement.');
    return this.summary();
  }
  summary() {
    return {meanDelivery:mean(this.completed.map(o=>o.deliveryTime)),delivered:this.completed.length,
      totalOrders:this.scenario.orders.length,time:this.time,reward:this.totalReward,orderSeconds:this.orderSeconds,
      extraEdges:this.extraEdges,utilization:this.couriers.map(c=>c.busySeconds/Math.max(1,this.time)),
      seed:this.scenario.seed};
  }
}

export function matchedOrders(learned,greedy) {
  const a=new Map(learned.completed.map(order=>[order.id,order]));
  const b=new Map(greedy.completed.map(order=>[order.id,order]));
  const result=[];
  // A contiguous prefix avoids hiding slow earlier orders when later ones finish.
  for(let id=0;a.has(id)&&b.has(id);id++) result.push({id,learned:a.get(id).deliveryTime,greedy:b.get(id).deliveryTime});
  return result;
}
export function evaluate(learner,seeds) {
  return seeds.map(seed=>{
    const scenario=createScenario(seed);
    return {seed,learned:new Simulation(scenario,'learned',learner,{learning:false,epsilon:0}).run(),
      greedy:new Simulation(scenario,'greedy').run(),eta:new Simulation(scenario,'eta').run(),
      random:new Simulation(scenario,'random').run()};
  });
}
