import test from 'node:test';
import assert from 'node:assert/strict';
import {City,Simulation,QLearner,createScenario,matchedOrders} from '../dist/simulation.js';

test('grid is connected with exactly 100 nodes and 180 bidirectional roads',()=>{
  const city=new City(createScenario());
  assert.equal(city.edges.length,180); assert.equal(city.neighbors.length,100);
  for(const edge of city.edges) assert.ok(city.neighbors[edge.b].some(n=>n.node===edge.a));
  for(let node=0;node<100;node++) assert.ok(Number.isFinite(city.route(0,node).cost));
});
test('Dijkstra optimizes cost, not number of edges',()=>{
  const city=new City(createScenario());
  for(const edge of city.edges) edge.cost=(edge.a===0 && edge.b===1)?100:1;
  city.cache.clear();
  assert.deepEqual(city.route(0,1).path,[0,10,11,1]);
  assert.equal(city.route(0,1).cost,3);
});
test('road snapshots change with rush hour and weather',()=>{
  const city=new City({seed:1,weather:[{start:0,end:100,column:0,strength:1}]});
  const first=city.edges.map(e=>e.cost); city.update(240);
  assert.ok(city.edges.some((e,i)=>e.cost!==first[i]));
});
test('numeric trace: 30s pickup travel + 10s wait + 30s delivery = 70s',()=>{
  const scenario={seed:1,starts:[14,99,90],weather:[],orders:[{id:0,created:0,restaurant:44,customer:47,prep:40}]};
  const sim=new Simulation(scenario,'eta');
  sim.run(); const order=sim.completed[0];
  assert.equal(order.courierId,0); assert.equal(order.restaurantArrival,30);
  assert.equal(order.pickup,40); assert.equal(order.delivered,70);
  assert.equal(sim.orderSeconds,70);
});
test('FIFO busy assignment drains every order and delay integral equals sojourn sum',()=>{
  const scenario=createScenario(23,60);
  scenario.orders.forEach((order,i)=>order.created=i*2);
  const sim=new Simulation(scenario,'greedy'); sim.run();
  assert.equal(sim.completed.length,60);
  assert.equal(sim.orderSeconds,sim.completed.reduce((sum,o)=>sum+o.deliveryTime,0));
  for(const c of sim.couriers) {
    const assigned=sim.orders.filter(o=>o.courierId===c.id).map(o=>o.id);
    const delivered=sim.completed.filter(o=>o.courierId===c.id).map(o=>o.id);
    assert.deepEqual(delivered,assigned);
  }
  assert.ok(sim.completed.every(o=>o.pickup>=o.created+o.prep));
});
test('a mid-edge courier must finish the current edge before becoming free',()=>{
  const sim=new Simulation({seed:1,starts:[0,99,98],weather:[],orders:[{id:0,created:0,restaurant:1,customer:2,prep:20}]},'eta');
  for(let i=0;i<5;i++) sim.step();
  const c=sim.couriers[0]; assert.equal(c.node,0); assert.equal(c.progress,5);
  assert.equal(sim.forecast(c).freeIn,25);
});
test('Q update bootstraps then uses zero continuation at terminal',()=>{
  const q=new QLearner(); q.table.set('next',[2,4,3]);
  q.update('state',1,-1,'next'); assert.ok(Math.abs(q.values('state')[1]-0.12*(-1+0.92*4))<1e-10);
  q.update('terminal',0,-5,null); assert.equal(q.values('terminal')[0],-0.6);
  assert.equal(q.epsilon,1); q.decisions=100000; assert.equal(q.epsilon,0.05);
});
test('paired runs are reproducible, frozen evaluation does not mutate learner',()=>{
  const q=new QLearner(), before=JSON.stringify(q.serialize());
  const scenario=createScenario(42);
  const a=new Simulation(scenario,'learned',q,{learning:false,epsilon:0}); a.run();
  const b=new Simulation(createScenario(42),'learned',q,{learning:false,epsilon:0}); b.run();
  assert.deepEqual(a.completed,b.completed); assert.equal(JSON.stringify(q.serialize()),before);
  assert.equal(matchedOrders(a,b).length,40);
});
test('matching does not skip an unfinished earlier order',()=>{
  const completed=[{id:1,deliveryTime:20}];
  assert.deepEqual(matchedOrders({completed},{completed}),[]);
});
test('potential shaping telescopes to the discounted base return',()=>{
  const learner=new QLearner(), shapedRewards=[], baseRewards=[];
  let baseSinceUpdate=0;
  const originalUpdate=learner.update.bind(learner);
  learner.update=(state,action,reward,next)=>{
    shapedRewards.push(reward);baseRewards.push(baseSinceUpdate);baseSinceUpdate=0;
    originalUpdate(state,action,reward,next);
  };
  const sim=new Simulation(createScenario(314,12),'learned',learner);
  baseSinceUpdate=sim.intervalReward;
  const originalAdd=sim.addReward.bind(sim);
  sim.addReward=reward=>{baseSinceUpdate+=reward;originalAdd(reward);};
  sim.run();
  const shaped=shapedRewards.reduce((sum,r,i)=>sum+0.92**i*r,0);
  const base=baseRewards.reduce((sum,r,i)=>sum+0.92**i*r,0);
  assert.ok(Math.abs(shaped-base)<1e-8); // initial and terminal potential are 0
  assert.equal(shapedRewards.length,12);
  assert.ok(Math.abs(baseRewards.reduce((a,b)=>a+b,0)-sim.totalReward)<1e-8);
});
