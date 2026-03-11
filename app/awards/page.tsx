import { players } from "@/lib/players";

function calculatePoints(p:any){

let pts=0;

pts+=p.runs;
pts+=p.wickets*16;
pts+=p.catches*8;

if(p.dismissed && p.runs===0){

if(p.balls===0) pts-=10;
else if(p.balls===1) pts-=8;
else pts-=5;

}

return pts;

}

export default function Awards(){

const sorted=[...players]
.map(p=>({...p,points:calculatePoints(p)}))
.sort((a,b)=>b.points-a.points);

const playerOfWeek=sorted[0];
const teamOfWeek=sorted.slice(0,11);

return(

<div className="p-10 bg-black min-h-screen text-white">

<h1 className="text-3xl mb-6">Weekly Awards</h1>

<h2 className="text-xl mb-2">Player of the Week</h2>
<p>{playerOfWeek.name} — {playerOfWeek.points} pts</p>

<h2 className="text-xl mt-6 mb-2">Team of the Week</h2>

{teamOfWeek.map(p=>(

<p key={p.id}>
{p.name} — {p.points}
</p>

))}

</div>

);

}