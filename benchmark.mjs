import {writeFile} from 'node:fs/promises';
import {QLearner,Simulation,createScenario,evaluate,mean,SETTINGS} from './dist/simulation.js';
const episodes=Number(process.argv[2]||600);
const learner=new QLearner();
const validationSeeds=Array.from({length:10},(_,i)=>80000+i);
const history=[];
function checkpoint() {
  const rows=evaluate(learner,validationSeeds);
  const record={episode:learner.episodes,epsilon:learner.epsilon,states:learner.table.size,
    learned:mean(rows.map(r=>r.learned.meanDelivery)),greedy:mean(rows.map(r=>r.greedy.meanDelivery)),
    eta:mean(rows.map(r=>r.eta.meanDelivery)),random:mean(rows.map(r=>r.random.meanDelivery))};
  history.push(record); console.log(JSON.stringify(record));
}
checkpoint();
for(let i=0;i<episodes;i++) {
  new Simulation(createScenario(1000+i),'learned',learner).run();
  if((i+1)%100===0 || i===episodes-1) checkpoint();
}
// Never use these final test seeds to train or select a checkpoint.
const heldOut=evaluate(learner,Array.from({length:30},(_,i)=>91000+i));
const differences=heldOut.map(r=>r.greedy.meanDelivery-r.learned.meanDelivery);
const averageDifference=mean(differences);
const standardDeviation=Math.sqrt(differences.reduce((sum,d)=>sum+(d-averageDifference)**2,0)/(differences.length-1));
const margin=2.045*standardDeviation/Math.sqrt(differences.length);
const summary={learned:mean(heldOut.map(r=>r.learned.meanDelivery)),greedy:mean(heldOut.map(r=>r.greedy.meanDelivery)),
  eta:mean(heldOut.map(r=>r.eta.meanDelivery)),random:mean(heldOut.map(r=>r.random.meanDelivery)),
  pairedImprovementSeconds:averageDifference,confidence95:[averageDifference-margin,averageDifference+margin],
  wins: differences.filter(d=>d>0).length,testSeeds:30};
const result={settings:SETTINGS,trainingEpisodes:episodes,history,summary,heldOut};
await writeFile(new URL('./dist/benchmark-results.json',import.meta.url),JSON.stringify(result,null,2));
await writeFile(new URL('./dist/trained-policy.json',import.meta.url),JSON.stringify(learner.serialize()));
console.log('HELD-OUT RESULT',JSON.stringify(summary));
