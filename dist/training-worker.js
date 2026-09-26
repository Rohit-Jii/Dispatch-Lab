import {QLearner,Simulation,createScenario,evaluate,mean} from './simulation.js';
// Training runs off the UI thread; every evaluation freezes Q and sets epsilon=0.
self.onmessage=({data})=>{
  try {
    const learner=QLearner.restore(data.learner);
    const history=[];
    const validationSeeds=Array.from({length:6},(_,i)=>80000+i);
    function checkpoint() {
      const rows=evaluate(learner,validationSeeds);
      history.push({episode:learner.episodes,learned:mean(rows.map(r=>r.learned.meanDelivery)),
        greedy:mean(rows.map(r=>r.greedy.meanDelivery)),eta:mean(rows.map(r=>r.eta.meanDelivery))});
    }
    checkpoint();
    for(let episode=0;episode<data.episodes;episode++) {
      const seed=1000+learner.episodes;
      new Simulation(createScenario(seed),'learned',learner).run();
      if((episode+1)%50===0) checkpoint();
      if((episode+1)%10===0) self.postMessage({type:'progress',completed:episode+1,history});
    }
    self.postMessage({type:'complete',learner:learner.serialize(),history});
  } catch(error) {self.postMessage({type:'error',message:error.message});}
};
